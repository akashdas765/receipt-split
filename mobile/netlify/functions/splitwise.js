import { proxySplitwise } from '../../shared/splitwiseProxy.js';

export const handler = async (event) => {
  const authHeader = event.headers['authorization'];
  const idToken    = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const { status, bodyText } = await proxySplitwise({
    idToken,
    swKey:       event.headers['x-splitwise-key'],
    method:      event.httpMethod,
    path:        event.queryStringParameters?.path,
    contentType: event.headers['content-type'],
    body:        event.httpMethod === 'POST' ? event.body : undefined,
  });

  return {
    statusCode: status,
    headers:    { 'Content-Type': 'application/json' },
    body:       bodyText,
  };
};
