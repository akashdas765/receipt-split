const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// The client builds the full chat-completions payload (model, messages,
// max_tokens) exactly as before — this just forwards it to Groq with the
// real API key attached server-side, so the key never ships in the client
// bundle (previously it was a VITE_* env var, sent as Authorization straight
// from the browser).
export async function proxyGroq({ body }) {
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
