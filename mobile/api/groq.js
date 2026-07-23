import { proxyGroq } from '../shared/groqProxy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers['authorization'];
  const idToken    = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  try {
    // Vercel auto-parses a JSON request body into req.body — re-stringify to
    // forward it as-is rather than relying on parser/serializer symmetry.
    const { status, bodyText, provider } = await proxyGroq({ idToken, body: JSON.stringify(req.body) });
    res.status(status).setHeader('Content-Type', 'application/json');
    if (provider) res.setHeader('X-Ai-Provider', provider);
    res.send(bodyText);
  } catch (err) {
    // Belt-and-suspenders: any exception here must still come back as JSON,
    // not a platform crash page that res.json() on the client can't parse.
    res.status(500).json({ error: err.message || 'Unexpected proxy error' });
  }
}
