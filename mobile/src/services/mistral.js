import { MISTRAL_API_KEY } from '../config';

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
  "total": 0.00
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
10. CATEGORIES: food, drink, alcohol, tip, fee, other.
11. All amounts positive. Use null for unknown fields.`;

function stripFences(text) {
  if (text.includes('```json')) return text.split('```json')[1].split('```')[0].trim();
  if (text.includes('```'))     return text.split('```')[1].split('```')[0].trim();
  return text.trim();
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
  return parsed;
}

function purchasableSum(parsed) {
  return (parsed.items || []).reduce((s, i) => {
    const cat = (i.category || '').toLowerCase();
    return (cat === 'tax' || cat === 'tip') ? s : s + (parseFloat(i.amount) || 0);
  }, 0);
}

async function callMistral(base64, mime, userText) {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'pixtral-12b-2409',
      messages: [
        { role: 'system', content: PARSE_SYSTEM },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          { type: 'text', text: userText },
        ]},
      ],
      max_tokens: 4096,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || 'Mistral API error');
  return JSON.parse(stripFences(data.choices[0].message.content));
}

// base64: raw base64 string (no data URI prefix), mime: 'image/jpeg' or 'image/png'
export async function parseReceiptImage(base64, mime = 'image/jpeg') {
  if (!MISTRAL_API_KEY || MISTRAL_API_KEY === 'YOUR_MISTRAL_KEY_HERE') {
    throw new Error('Add your Mistral API key to src/config.js');
  }

  let parsed = await callMistral(base64, mime, 'Parse this receipt and return the JSON.');

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
      const parsed2 = await callMistral(base64, mime,
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
