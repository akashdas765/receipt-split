import { auth } from './firebase';
import { detectCategory } from '../utils/categoryDetector';
import { isPaymentTransaction } from '../utils/paymentDetector';

// Same auth-gated proxy pattern as groq.js/splitwise.js.
const PROXY = '/.netlify/functions/plaid';

async function plaidFetch(action, payload = {}) {
  let idToken;
  try {
    idToken = await auth.currentUser?.getIdToken();
  } catch {
    idToken = null;
  }

  const res = await fetch(PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const data = await res.json();
  if (!res.ok || data?.error_message || data?.error) {
    throw new Error(data?.error_message || data?.error || 'Plaid request failed.');
  }
  return data;
}

// redirect_uri is only meaningful for OAuth institutions (Chase, Capital
// One, …) in Production — Sandbox test institutions don't use OAuth, so
// this is harmless (and unused server-side) there. Must exactly match a
// URL registered in the Plaid Dashboard under Developers -> API -> Allowed
// Redirect URIs — see PlaidConnect.jsx.
export async function createLinkToken() {
  const redirectUri = `${window.location.origin}/statements`;
  const data = await plaidFetch('create_link_token', { redirect_uri: redirectUri });
  return data.link_token;
}

export async function exchangePublicToken(publicToken) {
  const data = await plaidFetch('exchange_public_token', { public_token: publicToken });
  return { accessToken: data.access_token, itemId: data.item_id };
}

// Backfills the linked-account list (name/mask per card) for connections
// made before this app captured that from Link's onSuccess metadata —
// that metadata only ever fires once, at connect time, so this is the only
// way an already-linked Item can recover its account list. `type` (Plaid's
// own 'depository'/'credit'/... classification) is included so callers can
// default the bank-vs-credit-card tag from it, rather than starting blank.
export async function fetchAccounts(accessToken) {
  const data = await plaidFetch('get_accounts', { access_token: accessToken });
  return (data.accounts || []).map(a => ({ id: a.account_id, name: a.name, mask: a.mask, type: a.type }));
}

// Live balances for every account under one Item — used by HomePage's net
// worth card. `current` is what's actually in a depository account, or
// what's owed on a credit account (both non-negative from Plaid; the
// caller decides sign/direction based on the account's bank-vs-credit tag,
// since Plaid's own field doesn't carry that meaning).
export async function fetchAccountBalances(accessToken) {
  const data = await plaidFetch('get_balances', { access_token: accessToken });
  return (data.accounts || []).map(a => ({
    id:              a.account_id,
    name:            a.name,
    mask:            a.mask,
    type:            a.type,
    current:         a.balances?.current ?? null,
    available:       a.balances?.available ?? null,
    isoCurrencyCode: a.balances?.iso_currency_code || 'USD',
  }));
}

// Pages through every added/removed transaction since `cursor` (omit on
// first sync = full history), turning Plaid's shape into this app's own —
// reusing the same client-side category/payment detection csvParser.js and
// statementPdfParser.js already use, rather than reconciling yet another
// category taxonomy on top of the ones those already juggle.
export async function syncTransactions(accessToken, cursor) {
  let allAdded = [];
  let allRemovedIds = [];
  let nextCursor = cursor || undefined;
  let hasMore = true;

  while (hasMore) {
    const data = await plaidFetch('sync_transactions', { access_token: accessToken, cursor: nextCursor });
    allAdded = allAdded.concat(data.added || []);
    allRemovedIds = allRemovedIds.concat((data.removed || []).map(t => `plaid-${t.transaction_id}`));
    nextCursor = data.next_cursor;
    hasMore = data.has_more;
  }

  // Plaid's sign convention: positive amount = money OUT of the account
  // (an expense), negative = money in (a payment/refund/credit) — the
  // opposite of some other systems. Credits used to be dropped entirely
  // here; they're now kept (as a positive magnitude + isCredit) so bill
  // payments/refunds actually show up instead of vanishing at sync time.
  // Pending transactions get a new transaction_id once they post, so
  // importing them now would just leave an orphaned duplicate row once the
  // real one arrives.
  const transactions = allAdded
    .filter(t => !t.pending)
    .map(t => {
      const desc = t.merchant_name || t.name || 'Unknown';
      const isCredit = (t.amount || 0) < 0;
      return {
        id:          `plaid-${t.transaction_id}`,
        date:        t.date,
        description: desc,
        amount:      Math.abs(t.amount || 0),
        category:    detectCategory(desc),
        // A credit is never a personal purchase, so it rides the same
        // isPayment bucket that already excludes description-detected
        // transfers/payments from Splitwise matching and spend totals.
        isPayment:   isCredit || isPaymentTransaction(desc),
        isCredit,
        // One Plaid Item (one login) can cover several cards/accounts —
        // this is what lets PlaidConnect.jsx split a sync's results back
        // out per account instead of lumping every card into one group.
        accountId:   t.account_id,
      };
    });

  return { transactions, removedIds: allRemovedIds, cursor: nextCursor };
}
