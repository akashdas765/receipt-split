import { accountLabel } from '../utils/accountLabel';

// In-memory store for the current user's Splitwise API key, Plaid bank
// connections, and non-Plaid source classification. Set on login/signup,
// cleared on logout.
let _splitwiseKey = null;
let _userId       = null;

// Plaid: one entry per connected bank/card (itemId -> connection), so
// multiple accounts (Chase, Amex, ...) can be connected and synced
// independently — see PlaidConnect.jsx. cursor tracks each connection's
// own /transactions/sync progress.
let _plaidConnections = new Map();

// Bank-vs-credit tag for non-Plaid sources (CSV/PDF/manual — see
// db.js's sourceMeta), keyed by the transaction's own `source` string
// since those origins have no real account entity to hang the tag on the
// way Plaid connections do. See getAccountType below for how this and
// Plaid's own per-account tag are read through one function.
let _sourceMeta = new Map();

export const session = {
  setKey:    (key) => { _splitwiseKey = key; },
  getKey:    ()    => _splitwiseKey,
  setUserId: (id)  => { _userId = id; },
  getUserId: ()    => _userId,

  // Replaces the whole set — used on login/hydration once the full list is
  // loaded from Firestore.
  setPlaidConnections: (list = []) => {
    _plaidConnections = new Map(list.map(c => [c.itemId, c]));
  },
  // Partial update to one connection (e.g. just `cursor` after a sync)
  // without clobbering its other stored fields.
  upsertPlaidConnection: (conn) => {
    if (!conn?.itemId) return;
    const existing = _plaidConnections.get(conn.itemId) || {};
    _plaidConnections.set(conn.itemId, { ...existing, ...conn });
  },
  removePlaidConnection: (itemId) => { _plaidConnections.delete(itemId); },
  getPlaidConnections: () => Array.from(_plaidConnections.values()),
  getPlaidConnection:  (itemId) => _plaidConnections.get(itemId) || null,

  // Replaces the whole set — used on login/hydration once loaded from
  // Firestore, same pattern as setPlaidConnections.
  setSourceMeta: (map = {}) => {
    _sourceMeta = new Map(Object.entries(map));
  },
  upsertSourceMeta: (sourceId, fields) => {
    if (!sourceId) return;
    const existing = _sourceMeta.get(sourceId) || {};
    _sourceMeta.set(sourceId, { ...existing, ...fields });
  },
  getSourceMeta: (sourceId) => _sourceMeta.get(sourceId) || null,

  // Single source of truth for "is this account a bank/checking account or
  // a credit card" — checks Plaid's own per-account tag first (the
  // authoritative store for Plaid sources, see PlaidConnect.jsx's
  // saveAccountType), then falls back to sourceMeta for everything else
  // (CSV/PDF/manual). Returns 'bank' | 'credit' | undefined (unclassified).
  getAccountType: (source) => {
    if (!source) return undefined;
    if (source.startsWith('plaid-')) {
      for (const conn of _plaidConnections.values()) {
        for (const acct of conn.accounts || []) {
          if (source === `plaid-${conn.itemId}-${acct.id}`) return acct.accountType;
        }
      }
      return undefined;
    }
    return _sourceMeta.get(source)?.accountType;
  },

  // Used by matcher.js's callers (StatementsPage.jsx, insights.js) to keep
  // Splitwise auto-matching off bank/checking accounts — those balances
  // don't correspond to Splitwise group expenses the way a credit card
  // charge does, so scoring them just produces bogus matches. Manual
  // linking (overrideSplitwiseId) still works regardless, since that path
  // in matcher.js never calls this. Unclassified sources of any origin
  // default to false, so this only ever narrows matching, never silently
  // breaks it.
  isBankAccountSource: (source) => session.getAccountType(source) === 'bank',

  // Flattens every connection's raw Plaid account names (not accountLabel()
  // — bank-generated transfer text like "Deposit from 360 Performance
  // Savings" quotes Plaid's own name, which a user-set nickname would no
  // longer match against) across all connections. Used by
  // utils/transferMatcher.js's text-hint tier. `label` is still
  // accountLabel()'s nickname-aware string, kept alongside for display
  // once a hint is matched.
  getAllMyAccountNames: () => {
    const out = [];
    for (const conn of _plaidConnections.values()) {
      for (const acct of conn.accounts || []) {
        if (!acct.name) continue;
        out.push({
          source:  `plaid-${conn.itemId}-${acct.id}`,
          rawName: acct.name,
          label:   accountLabel(acct),
        });
      }
    }
    return out;
  },

  clear: () => {
    _splitwiseKey = null; _userId = null;
    _plaidConnections = new Map();
    _sourceMeta = new Map();
  },
};
