import { proxySplitwise } from '../shared/splitwiseProxy.js';

export default async function handler(req, res) {
  // Vercel auto-parses urlencoded bodies into an object; reconstruct the
  // wire format Splitwise expects rather than relying on parser internals.
  const body = req.method === 'POST' ? new URLSearchParams(req.body).toString() : undefined;

  const { status, bodyText } = await proxySplitwise({
    swKey:       req.headers['x-splitwise-key'],
    method:      req.method,
    path:        req.query?.path,
    contentType: 'application/x-www-form-urlencoded',
    body,
  });

  res.status(status).setHeader('Content-Type', 'application/json').send(bodyText);
}
