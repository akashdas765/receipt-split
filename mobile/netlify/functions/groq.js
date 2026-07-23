import { proxyGroq } from '../../shared/groqProxy.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  const idToken    = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  try {
    const { status, bodyText, provider } = await proxyGroq({ idToken, body: event.body });
    return {
      statusCode: status,
      headers:    { 'Content-Type': 'application/json', ...(provider ? { 'X-Ai-Provider': provider } : {}) },
      body:       bodyText,
    };
  } catch (err) {
    // Belt-and-suspenders: any exception here must still come back as JSON,
    // not a platform crash page that res.json() on the client can't parse.
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message || 'Unexpected proxy error' }) };
  }
};
