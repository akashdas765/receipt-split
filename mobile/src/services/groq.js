import { auth } from './firebase';
import { ALL_CATEGORIES } from '../utils/categoryDetector';

// Requests go through our serverless proxy so the Groq API key never ships
// in the client bundle (previously a VITE_* env var read straight from here).
// The proxy requires a valid Firebase ID token so it can't be used as an
// anonymous free relay to Groq by anyone who finds the endpoint.
const PROXY = '/.netlify/functions/groq';

const PARSE_SYSTEM = `You are a receipt parsing assistant. Extract ALL purchased line items from the receipt image with exact accuracy. Return valid JSON only — no extra text, no markdown fences.

JSON structure:
{
  "merchant": "store name or null",
  "date": "YYYY-MM-DD or null",
  "items": [
    {"description": "item name", "quantity": 1, "amount": 0.00, "category": "food|drink|alcohol|tip|fee|other"}
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00,
  "spendCategory": "one of: ${ALL_CATEGORIES.join(', ')}"
}

Strict rules:
1. ITEMS ONLY: Never include subtotal, tax, sales tax, VAT, or grand total lines as items.
2. TOP-LEVEL FIELDS: Put pre-tax sum in "subtotal", total tax in "tax", gratuity in "tip", grand total in "total".
3. SCAN EVERY LINE: Never skip a purchased item.
4. QUANTITY: Set exactly as printed. "12 Bud Light" → quantity=12. Never reduce.
5. AMOUNT: LINE TOTAL (quantity × unit price), not unit price.
6. DO NOT MERGE: Same item multiple times → multiple entries.
7. DO NOT TRUNCATE: Include every single item.
8. VERIFY: Sum all items ≈ subtotal (pre-tax).
9. TIP: Include as item with category "tip" AND set top-level tip field.
10. CATEGORIES (per item): food, drink, alcohol, tip, fee, other.
11. All amounts positive. Use null for unknown fields.
12. SPEND CATEGORY: "spendCategory" is ONE category for the WHOLE receipt (not per item) — pick from the exact list given above based on the merchant name and what was purchased (e.g. a grocery store → "Groceries", a restaurant → "Food & Dining", a pharmacy → "Healthcare"). If genuinely unclear, use "Other".`;

function stripFences(text) {
  if (text.includes('```json')) return text.split('```json')[1].split('```')[0].trim();
  if (text.includes('```'))     return text.split('```')[1].split('```')[0].trim();
  return text.trim();
}

// The model is told "valid JSON only, no extra text" but doesn't always
// obey it — an unusual input (e.g. a delivery-app screenshot instead of a
// real paper receipt) can make it wrap the object in a stray leading/
// trailing sentence, or use a bullet-point `*` outside the JSON entirely.
// Rather than trust the whole response is parseable as-is, pull out just
// the outermost {...} so surrounding prose can't break JSON.parse.
function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

function reconcile(parsed) {
  const EXCLUDE_CATS   = new Set(['tax']);
  const EXCLUDE_EXACT  = new Set(['tax','sales tax','vat','hst','gst','tax total',
    'subtotal','sub total','sub-total','total','grand total','net total',
    'amount due','balance due','total due']);
  const EXCLUDE_STARTS = ['sales tax','tax ','subtotal','sub total',
    'grand total','total due','amount due','balance due'];

  parsed.items = (parsed.items || []).filter(item => {
    const cat  = (item.category || '').toLowerCase().trim();
    const desc = (item.description || '').toLowerCase().trim();
    if (EXCLUDE_CATS.has(cat))  return false;
    if (EXCLUDE_EXACT.has(desc)) return false;
    if (EXCLUDE_STARTS.some(p => desc.startsWith(p))) return false;
    return true;
  });
  // Guard against a hallucinated/malformed value — spendCategory must be
  // exactly one of the categories given in the prompt, or DetailPage's
  // category dropdown (which only offers ALL_CATEGORIES) would show
  // something not in its own option list.
  if (!ALL_CATEGORIES.includes(parsed.spendCategory)) parsed.spendCategory = 'Other';
  return parsed;
}

function purchasableSum(parsed) {
  return (parsed.items || []).reduce((s, i) => {
    const cat = (i.category || '').toLowerCase();
    return (cat === 'tax' || cat === 'tip') ? s : s + (parseFloat(i.amount) || 0);
  }, 0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function attemptGroq(base64, mime, userText) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  // getIdToken() has known failures in restricted WebKit contexts (e.g. an
  // installed iOS PWA's storage partitioning) — if it throws, fall back to
  // an unauthenticated request rather than let a cryptic WebKit error (e.g.
  // "The string did not match the expected pattern.") leak to the user;
  // the proxy will then give a clear "Missing or invalid auth token" 401.
  let idToken;
  try {
    idToken = await auth.currentUser?.getIdToken();
  } catch {
    idToken = null;
  }

  let res;
  try {
    res = await fetch(PROXY, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: PARSE_SYSTEM },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            { type: 'text', text: userText },
          ]},
        ],
        max_tokens: 4096,
        // qwen3.8-27b is a "thinking" model by default and prepends a
        // <think>...</think> reasoning block before the actual JSON, which
        // breaks JSON.parse. Disable reasoning entirely — we just want the
        // structured answer, not a rationale.
        reasoning_effort: 'none',
      }),
    });
  } catch (err) {
    // Both a timeout (our own abort) and a raw network failure (dropped
    // connection, DNS blip, offline for a moment) are transient — worth
    // retrying rather than failing the scan outright. See callGroq below.
    const message = err.name === 'AbortError' ? 'Request timed out. Check your connection and try again.' : err.message;
    const retryable = new Error(message);
    retryable.retryable = true;
    throw retryable;
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    // A non-JSON body (e.g. a platform error page during an outage) means
    // something went wrong before the request ever reached our own proxy
    // logic — also transient, also worth retrying.
    const err = new Error('Groq API error');
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    const err = new Error(message || 'Groq API error');
    // 5xx is Groq/the proxy having a bad moment — worth retrying. 4xx
    // (bad request, unsupported model, oversized body, auth failure) is
    // deterministic; retrying identical input won't change the outcome.
    err.retryable = res.status >= 500;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObject(stripFences(data.choices[0].message.content)));
  } catch {
    // Surface something a user can act on instead of a raw SyntaxError
    // ("Unrecognized token '*'") — that wording means nothing to someone
    // who just uploaded a photo. Not retryable — a malformed response
    // isn't a transient-failure symptom, retrying won't fix a bad parse.
    throw new Error('Could not read this image as a receipt. Try a clearer photo, or remove it and parse the others separately.');
  }
  // Surfaces which provider actually served this request (the proxy falls
  // back to NVIDIA when Groq is rate-limited) so the UI can let the user
  // know when that happened.
  parsed._provider = res.headers.get('X-Ai-Provider') || 'groq';
  return parsed;
}

// Up to 2 retries (3 attempts total) with short backoff, only for
// conditions attemptGroq marks retryable (network failure, timeout, 5xx) —
// a single-shot call meant every brief network blip or momentary Groq
// overload surfaced as a hard "scan failed" requiring the user to manually
// try again, even though a second attempt usually just works.
const MAX_ATTEMPTS   = 3;
const RETRY_DELAYS_MS = [800, 2000];

async function callGroq(base64, mime, userText) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptGroq(base64, mime, userText);
    } catch (err) {
      if (!err.retryable || attempt === MAX_ATTEMPTS - 1) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// base64: raw base64 string (no data URI prefix), mime: 'image/jpeg' or 'image/png'
export async function parseReceiptImage(base64, mime = 'image/jpeg') {

  let parsed = await callGroq(base64, mime, 'Parse this receipt and return the JSON.');

  // Retry if item sum is >12% off from subtotal
  const itemsSum  = purchasableSum(parsed);
  let   reference = parseFloat(parsed.subtotal || 0);
  if (!reference) {
    reference = Math.round((
      (parseFloat(parsed.total || 0))
      - (parseFloat(parsed.tax  || 0))
      - (parseFloat(parsed.tip  || 0))
    ) * 100) / 100;
  }

  if (reference > 0 && itemsSum > 0 && Math.abs(itemsSum - reference) / reference > 0.12) {
    try {
      const parsed2 = await callGroq(base64, mime,
        `Parse this receipt. IMPORTANT: your previous attempt found items totalling $${itemsSum.toFixed(2)} ` +
        `but the receipt subtotal is $${reference.toFixed(2)}. You missed some items. ` +
        `Re-read every single line carefully. Do NOT include tax, subtotal, or total lines as items.`
      );
      if (Math.abs(purchasableSum(parsed2) - reference) < Math.abs(itemsSum - reference)) {
        parsed = parsed2;
      }
    } catch { /* keep first parse */ }
  }

  return reconcile(parsed);
}
