import { verifyFirebaseToken } from './verifyFirebaseToken.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// The client builds the full chat-completions payload (model, messages,
// max_tokens) exactly as before — this just forwards it to Groq with the
// real API key attached server-side, so the key never ships in the client
// bundle (previously it was a VITE_* env var, sent as Authorization straight
// from the browser).
//
// Requires a valid Firebase Auth ID token — without this, the endpoint would
// forward any request to Groq using our own key, letting anyone (not just
// logged-in users of the app) run up usage on our account for free.
export async function proxyGroq({ idToken, body }) {
  const user = await verifyFirebaseToken(idToken);
  if (!user) {
    return { status: 401, bodyText: JSON.stringify({ error: 'Missing or invalid auth token' }) };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { status: 500, bodyText: JSON.stringify({ error: 'Server is missing GROQ_API_KEY' }) };
  }

  const groqRes = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  });

  return { status: groqRes.status, bodyText: await groqRes.text() };
}
