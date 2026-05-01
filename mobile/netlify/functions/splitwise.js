const SW_BASE = 'https://secure.splitwise.com/api/v3.0';

exports.handler = async (event) => {
  const swKey = event.headers['x-splitwise-key'];
  if (!swKey) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing x-splitwise-key header' }) };
  }

  const path = event.queryStringParameters?.path;
  if (!path || !path.startsWith('/')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid ?path= query param' }) };
  }

  const swRes = await fetch(`${SW_BASE}${path}`, {
    method: event.httpMethod,
    headers: {
      Authorization:  `Bearer ${swKey}`,
      'Content-Type': event.headers['content-type'] || 'application/x-www-form-urlencoded',
    },
    body: event.httpMethod === 'POST' ? event.body : undefined,
  });

  const text = await swRes.text();
  return {
    statusCode: swRes.status,
    headers:    { 'Content-Type': 'application/json' },
    body:       text,
  };
};
