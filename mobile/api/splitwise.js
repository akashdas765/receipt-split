const SW_BASE = 'https://secure.splitwise.com/api/v3.0';

export default async function handler(req, res) {
  const swKey = req.headers['x-splitwise-key'];
  if (!swKey) {
    res.status(401).json({ error: 'Missing x-splitwise-key header' });
    return;
  }

  const path = req.query?.path;
  if (!path || !path.startsWith('/')) {
    res.status(400).json({ error: 'Missing or invalid ?path= query param' });
    return;
  }

  // Vercel auto-parses urlencoded bodies into an object; reconstruct the
  // wire format Splitwise expects rather than relying on parser internals.
  const body = req.method === 'POST' ? new URLSearchParams(req.body).toString() : undefined;

  const swRes = await fetch(`${SW_BASE}${path}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${swKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await swRes.text();
  res.status(swRes.status).setHeader('Content-Type', 'application/json').send(text);
}
