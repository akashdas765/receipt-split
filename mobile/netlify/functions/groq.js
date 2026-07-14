import { proxyGroq } from '../../shared/groqProxy.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { status, bodyText } = await proxyGroq({ body: event.body });

  return {
    statusCode: status,
    headers:    { 'Content-Type': 'application/json' },
    body:       bodyText,
  };
};
