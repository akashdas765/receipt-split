import { verifyFirebaseToken } from './verifyFirebaseToken.js';

// The 3 Plaid calls this app's Link + Transactions flow needs. Each maps
// to exactly one Plaid endpoint — pagination (sync's has_more/next_cursor)
// and turning Plaid's transaction shape into this app's is the client's
// job (src/services/plaid.js), same division of labor as groqProxy.js /
// splitwiseProxy.js: this layer exists only to keep PLAID_SECRET out of
// the browser, not to encode app-specific logic.
const ACTIONS = {
  create_link_token: (uid, payload) => ['/link/token/create', {
    user:          { client_user_id: uid },
    client_name:   'ReceiptSplit',
    products:      ['transactions'],
    country_codes: ['US'],
    language:      'en',
    // Only OAuth institutions (Chase, Capital One, …) in Production use
    // this — harmless to include for Sandbox, which ignores it.
    ...(payload.redirect_uri ? { redirect_uri: payload.redirect_uri } : {}),
  }],
  exchange_public_token: (uid, payload) => {
    if (!payload.public_token) throw new Error('Missing public_token');
    return ['/item/public_token/exchange', { public_token: payload.public_token }];
  },
  sync_transactions: (uid, payload) => {
    if (!payload.access_token) throw new Error('Missing access_token');
    return ['/transactions/sync', {
      access_token: payload.access_token,
      cursor:       payload.cursor || undefined,
      count:        500,
    }];
  },
};

// Requires a valid Firebase Auth ID token — without this, the endpoint
// would forward any request to Plaid using our own client_id/secret,
// letting anyone (not just logged-in users of this app) drive Plaid calls
// on our account. user.sub (the Firebase uid) is passed as Plaid's
// client_user_id so each user's Link session is tied to their own account,
// not shared across users.
export async function proxyPlaid({ idToken, body }) {
  const user = await verifyFirebaseToken(idToken);
  if (!user) {
    return { status: 401, bodyText: JSON.stringify({ error: 'Missing or invalid auth token' }) };
  }

  // Read at call time, not module load time: in local dev, vite.config.js's
  // dev-server middleware imports this module (transitively) before its own
  // config factory function runs, and that factory is where
  // process.env.PLAID_* actually gets set from .env — a module-level const
  // here would permanently capture undefined from before that assignment
  // ever happened (see verifyFirebaseToken.js, which had exactly this bug).
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret    = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    return { status: 500, bodyText: JSON.stringify({ error: 'Server is missing PLAID_CLIENT_ID/PLAID_SECRET' }) };
  }
  // Trial-plan/production both use the production API host — Plaid retired
  // the separate "development" environment in favor of the Trial plan (real
  // data, free, capped at 10 connected Items). Sandbox is fake test data.
  const PLAID_BASE = process.env.PLAID_ENV === 'production'
    ? 'https://production.plaid.com'
    : 'https://sandbox.plaid.com';

  let payload;
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    return { status: 400, bodyText: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const build = ACTIONS[payload.action];
  if (!build) {
    return { status: 400, bodyText: JSON.stringify({ error: `Unknown action: ${payload.action}` }) };
  }

  let path, plaidBody;
  try {
    [path, plaidBody] = build(user.sub, payload);
  } catch (err) {
    return { status: 400, bodyText: JSON.stringify({ error: err.message }) };
  }

  // A network-level failure reaching Plaid must not escape as an uncaught
  // exception — see groqProxy.js for why (crashes the function, client
  // sees a platform error page instead of JSON).
  let plaidRes;
  try {
    plaidRes = await fetch(`${PLAID_BASE}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ client_id: clientId, secret, ...plaidBody }),
    });
  } catch (err) {
    return { status: 502, bodyText: JSON.stringify({ error: `Could not reach Plaid: ${err.message}` }) };
  }

  const bodyText = await plaidRes.text();
  if (!plaidRes.ok) {
    // Logged server-side only (never sent to the client, and never logs
    // the secret) — Plaid's client-facing error messages (e.g. "client_id
    // must be a properly formatted, non-empty string") don't say *why* the
    // credentials were rejected — expired env reload, wrong PLAID_ENV vs.
    // key pairing, revoked key, etc. — so this at least confirms which
    // action/host/env was involved when it's not obvious from the message.
    console.error(`Plaid ${payload.action} failed (${plaidRes.status}) against ${PLAID_BASE}, PLAID_ENV=${process.env.PLAID_ENV || '(unset)'}, client_id length=${clientId.length}:`, bodyText);
  }
  return { status: plaidRes.status, bodyText };
}
