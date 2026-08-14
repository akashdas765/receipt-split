import { syncTransactions } from './plaid';
import { deleteTransaction, getTransaction } from './db';
import { accountLabel } from '../utils/accountLabel';

// Every field a user can set on a transaction via the match/transfer/payment
// review UI (see utils/matcher.js, StatementsPage.jsx) — carried from a
// pending transaction onto the posted transaction that supersedes it, so a
// Splitwise match made while a charge was still pending isn't lost when it
// posts under a new id. Kept as one list so a new override field only needs
// adding here, not re-derived per call site.
const OVERRIDE_FIELDS = [
  'overrideSplitwiseId', 'overrideSplitwiseIds',
  'overrideExpenseData', 'overrideExpenseDataList',
  'overrideForcedUnmatched',
  'overrideConfirmedTransfer', 'overrideDismissedTransferHint',
  'overrideConfirmedPayment', 'overrideDismissedPaymentHint',
];

// A posted transaction's pendingTransactionId (see services/plaid.js) points
// at the pending row it replaces — look that row up and copy over whatever
// override fields it has. Returns `txn` unchanged if there's no pending
// link, no prior doc, or the prior doc has no overrides set.
async function carryOverridesForward(txn) {
  if (!txn.pendingTransactionId) return txn;
  const prior = await getTransaction(txn.pendingTransactionId).catch(() => null);
  if (!prior) return txn;
  const carried = {};
  for (const field of OVERRIDE_FIELDS) {
    if (prior[field] !== undefined) carried[field] = prior[field];
  }
  return Object.keys(carried).length ? { ...txn, ...carried } : txn;
}

// plaid.js stamps every synced transaction with a fresh
// `category: detectCategory(desc)` guess (see its own comment) — fine for a
// transaction Firestore has never seen, but Plaid resends a transaction
// under `modified` for reasons that have nothing to do with its category
// (a pending amount settling, a merchant name tweak), and a full resync
// (PlaidConnect's "Restore full history") resends EVERY past transaction —
// either would otherwise silently blow away a category the user manually
// corrected (or one already auto-detected and left alone), overwriting it
// right back to whatever keyword-matching guesses today via addTransactions'
// merge:true write. Dropping `category` from the outgoing object (rather
// than setting it back to the old value) is what actually protects it —
// merge:true only leaves a field untouched when it's absent from the write
// entirely. Only applies once a transaction already has a stored category;
// a genuinely new one still gets its first auto-detected guess.
async function preserveStoredCategory(txn) {
  const existing = await getTransaction(txn.id).catch(() => null);
  if (!existing?.category) return txn;
  const rest = { ...txn };
  delete rest.category;
  return rest;
}

// Core of a Plaid sync, extracted from PlaidConnect.jsx's doSync so it can
// run without that component being mounted — needed by StatementsPage.jsx's
// auto-fix for legacy-format transactions (see the source-format comment in
// StatementsPage.jsx), which has to run on page load regardless of whether
// the user ever opens the "Add" sheet PlaidConnect lives in.
//
// conn: a connection object with at least {itemId, accessToken, cursor,
// accounts, institutionName} (session.getPlaidConnection(itemId) shape).
// onAdd(transactions, sourceName): same callback StatementsPage already
// passes to PlaidConnect/StatementUpload — one call per account/card.
// Returns the new cursor to persist; does not touch session/Firestore
// connection state itself, callers do that (mirrors the original doSync).
export async function syncPlaidConnection(conn, { full = false, onAdd }) {
  // full=true re-pulls the whole history from scratch (cursor reset to
  // null) instead of only what's new since the stored cursor — used to
  // re-tag transactions synced before per-card splitting existed, so they
  // pick up the right accountId/source without creating duplicates
  // (transaction ids are stable, and addTransactions merges).
  const result = await syncTransactions(conn.accessToken, full ? null : conn.cursor);

  if (result.transactions.length) {
    // Split one sync's results back out per card — a single login can
    // cover several accounts, so lumping them all under one source would
    // undo the whole point of telling them apart.
    const byAccount = new Map();
    result.transactions.forEach(t => {
      const key = t.accountId || 'unknown';
      if (!byAccount.has(key)) byAccount.set(key, []);
      byAccount.get(key).push(t);
    });
    const accounts = conn.accounts || [];
    for (const [accountId, txns] of byAccount) {
      const acct  = accounts.find(a => a.id === accountId);
      const label = acct ? accountLabel(acct) : (conn.institutionName || 'Bank (Plaid)');
      const withSource = await Promise.all(
        txns.map(t => carryOverridesForward({ ...t, source: `plaid-${conn.itemId}-${accountId}` }).then(preserveStoredCategory))
      );
      await onAdd(withSource, label);
    }
  }

  for (const id of result.removedIds) {
    await deleteTransaction(id).catch(() => {});
  }

  return { cursor: result.cursor };
}
