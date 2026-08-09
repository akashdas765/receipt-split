import { syncTransactions } from './plaid';
import { deleteTransaction } from './db';
import { accountLabel } from '../utils/accountLabel';

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
      const withSource = txns.map(t => ({ ...t, source: `plaid-${conn.itemId}-${accountId}` }));
      await onAdd(withSource, label);
    }
  }

  for (const id of result.removedIds) {
    await deleteTransaction(id).catch(() => {});
  }

  return { cursor: result.cursor };
}
