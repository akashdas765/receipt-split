const functions = require('firebase-functions');
const fetch     = require('node-fetch');

const SW_BASE = 'https://secure.splitwise.com/api/v3.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-splitwise-key',
};

exports.splitwise = functions.https.onRequest(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set(CORS_HEADERS).status(204).send('');
    return;
  }

  const swKey = req.headers['x-splitwise-key'];
  if (!swKey) {
    res.set(CORS_HEADERS).status(401).json({ error: 'Missing x-splitwise-key header' });
    return;
  }

  // path comes from query param: ?path=/get_groups
  const path = req.query.path;
  if (!path || !path.startsWith('/')) {
    res.set(CORS_HEADERS).status(400).json({ error: 'Missing or invalid ?path= query param' });
    return;
  }

  try {
    const swRes = await fetch(`${SW_BASE}${path}`, {
      method:  req.method,
      headers: {
        Authorization:  `Bearer ${swKey}`,
        'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
      },
      body: req.method === 'POST' ? req.rawBody : undefined,
    });

    const text = await swRes.text();
    res.set(CORS_HEADERS)
       .set('Content-Type', 'application/json')
       .status(swRes.status)
       .send(text);
  } catch (err) {
    res.set(CORS_HEADERS).status(502).json({ error: err.message });
  }
});
