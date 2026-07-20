import { proxyGroq } from '../../shared/groqProxy.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  const idToken    = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const { status, bodyText } = await proxyGroq({ idToken, body: event.body });

  return {
    statusCode: status,
    headers:    { 'Content-Type': 'application/json' },
    body:       bodyText,
  };
};
