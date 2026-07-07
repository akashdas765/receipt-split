const SW_BASE = 'https://secure.splitwise.com/api/v3.0';

// Framework-agnostic core of the Splitwise CORS proxy. Both the Netlify
// function and the Vercel function are thin adapters that translate their
// platform's request/response shape to/from this, so the actual proxying
// logic only has to be correct in one place instead of two.
export async function proxySplitwise({ swKey, method, path, contentType, body }) {
  if (!swKey) {
    return { status: 401, bodyText: JSON.stringify({ error: 'Missing x-splitwise-key header' }) };
  }
  if (!path || !path.startsWith('/')) {
    return { status: 400, bodyText: JSON.stringify({ error: 'Missing or invalid ?path= query param' }) };
  }

  const swRes = await fetch(`${SW_BASE}${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${swKey}`,
      'Content-Type': contentType || 'application/x-www-form-urlencoded',
    },
    body: method === 'POST' ? body : undefined,
  });

  return { status: swRes.status, bodyText: await swRes.text() };
}
