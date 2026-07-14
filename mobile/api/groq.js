import { proxyGroq } from '../shared/groqProxy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Vercel auto-parses a JSON request body into req.body — re-stringify to
  // forward it as-is rather than relying on parser/serializer symmetry.
  const { status, bodyText } = await proxyGroq({ body: JSON.stringify(req.body) });

  res.status(status).setHeader('Content-Type', 'application/json').send(bodyText);
}
