import { verifyFirebaseToken } from './verifyFirebaseToken.js';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// meta/llama-3.2-11b-vision-instruct chosen over the 90b variant for lower
// latency — this only runs when Groq is already rate-limiting us, so
// responsiveness matters more than squeezing out extra accuracy.
const NVIDIA_MODEL = 'meta/llama-3.2-11b-vision-instruct';

// Signup is open, so "has a valid Firebase token" isn't much of a barrier to
// someone wanting to run arbitrary inference on our Groq/NVIDIA quota. Pin
// the request to the exact models this app actually sends — the receipt
// parser's vision model (src/services/groq.js's callGroq) and Insights'
// chat model (src/services/insights.js's askInsightsChat) — so the endpoint
// can't be repurposed as a general-purpose LLM its billing foots.
const ALLOWED_MODELS = new Set(['qwen/qwen3.6-27b', 'openai/gpt-oss-20b']);
const MAX_TOKENS_CAP = 4096;
// Receipt/statement images are sent inline as base64, so the body is
// legitimately a few MB — cap generously, only to stop absurd abuse.
const MAX_BODY_BYTES = 12 * 1024 * 1024;

async function callGroq(apiKey, body) {
  return fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  });
}

async function callNvidia(apiKey, body) {
  // Swap in NVIDIA's model id and drop Groq/qwen-specific params (e.g.
  // reasoning_effort) that NVIDIA's API doesn't know about.
  const payload = JSON.parse(body);
  delete payload.reasoning_effort;
  payload.model = NVIDIA_MODEL;

  return fetch(NVIDIA_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
}

// The client builds the full chat-completions payload (model, messages,
// max_tokens) exactly as before — this just forwards it to Groq with the
// real API key attached server-side, so the key never ships in the client
// bundle (previously it was a VITE_* env var, sent as Authorization straight
// from the browser).
//
// Requires a valid Firebase Auth ID token — without this, the endpoint would
// forward any request to Groq using our own key, letting anyone (not just
// logged-in users of the app) run up usage on our account for free.
//
// If Groq comes back rate-limited (429), automatically retries the same
// request against NVIDIA's free build.nvidia.com endpoint instead of
// surfacing the rate-limit error to the user.
export async function proxyGroq({ idToken, body }) {
  const user = await verifyFirebaseToken(idToken);
  if (!user) {
    return { status: 401, bodyText: JSON.stringify({ error: 'Missing or invalid auth token' }) };
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return { status: 500, bodyText: JSON.stringify({ error: 'Server is missing GROQ_API_KEY' }) };
  }

  // Reject anything that isn't the receipt-parser request this app makes:
  // wrong model, oversized token budget, or an implausibly large body. This
  // keeps the endpoint from being used as a free general-purpose LLM.
  if (typeof body === 'string' && Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return { status: 413, bodyText: JSON.stringify({ error: 'Request body too large' }) };
  }
  let parsedBody;
  try {
    parsedBody = JSON.parse(body || '{}');
  } catch {
    return { status: 400, bodyText: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  if (!ALLOWED_MODELS.has(parsedBody.model)) {
    return { status: 400, bodyText: JSON.stringify({ error: 'Unsupported model' }) };
  }
  if (typeof parsedBody.max_tokens !== 'number' || parsedBody.max_tokens > MAX_TOKENS_CAP) {
    parsedBody.max_tokens = MAX_TOKENS_CAP;
  }
  // Forward the normalized payload rather than the raw body, so the clamp
  // above actually takes effect (and callNvidia re-parses this same string).
  body = JSON.stringify(parsedBody);

  // A network-level failure reaching Groq (dropped connection, EPIPE on a
  // large image body, DNS blip, ...) must not escape as an uncaught
  // exception — that crashes the whole function and the client sees a
  // platform error page instead of JSON, which res.json() then chokes on.
  let groqRes;
  try {
    groqRes = await callGroq(groqKey, body);
  } catch (err) {
    return { status: 502, bodyText: JSON.stringify({ error: `Could not reach Groq: ${err.message}` }) };
  }

  const nvidiaKey = process.env.NVIDIA_API_KEY;
  if (groqRes.status !== 429 || !nvidiaKey) {
    return { status: groqRes.status, bodyText: await groqRes.text(), provider: 'groq' };
  }

  let nvidiaRes;
  try {
    nvidiaRes = await callNvidia(nvidiaKey, body);
  } catch {
    // Fallback itself failed — surface the original Groq rate-limit error
    // rather than a fallback-specific one, since that's the actual cause.
    return { status: groqRes.status, bodyText: await groqRes.text(), provider: 'groq' };
  }

  return { status: nvidiaRes.status, bodyText: await nvidiaRes.text(), provider: 'nvidia' };
}
