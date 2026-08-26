// Plaid links a posted transaction back to the pending hold it replaces via
// pendingTransactionId, and normally also reports the old pending id in its
// sync `removed` array so it gets deleted (see services/plaid.js,
// services/plaidSync.js) — but some institutions don't reliably send either
// signal. Seen in production: a restaurant preauth holds an estimated total
// (tip included) as pending, then the actual tipped amount posts later as a
// completely unlinked transaction. Left alone, the stale pending row sits
// next to the real posted charge forever, double-counted in spend totals
// and Splitwise splits.
//
// This finds those stragglers directly off the already-loaded transaction
// list (same "full list, matched client-side" shape as transferMatcher.js),
// rather than trusting Plaid's linkage to always have worked:
//  - Definitive: a posted transaction's pendingTransactionId points at this
//    pending row (Plaid did link them, but the `removed` delete apparently
//    didn't happen — e.g. a transient Firestore failure).
//  - Fallback: no linked posted transaction exists, but exactly one posted,
//    non-pending transaction on the same account has the same description
//    within a loose date window. Only acts when that candidate is unique —
//    an ambiguous case (two separate visits to the same merchant in the
//    window) is left alone rather than guessed at, since deleting the wrong
//    row would silently drop a real transaction.
const STALE_PENDING_WINDOW_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeDesc = desc => (desc || '').trim().toLowerCase();

export function findStalePendingIds(transactions) {
  const pending = transactions.filter(t => t.isPending);
  if (!pending.length) return [];
  const posted = transactions.filter(t => !t.isPending);
  if (!posted.length) return [];

  const staleIds = [];
  for (const p of pending) {
    if (posted.some(t => t.pendingTransactionId === p.id)) {
      staleIds.push(p.id);
      continue;
    }
    const candidates = posted.filter(t =>
      t.accountId === p.accountId &&
      normalizeDesc(t.description) === normalizeDesc(p.description) &&
      Math.abs(new Date(t.date) - new Date(p.date)) / DAY_MS <= STALE_PENDING_WINDOW_DAYS
    );
    if (candidates.length === 1) staleIds.push(p.id);
  }
  return staleIds;
}
