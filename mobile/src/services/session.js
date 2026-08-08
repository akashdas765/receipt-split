// In-memory store for the current user's Splitwise API key and Plaid bank
// connections. Set on login/signup, cleared on logout.
let _splitwiseKey = null;
let _userId       = null;

// Plaid: one entry per connected bank/card (itemId -> connection), so
// multiple accounts (Chase, Amex, ...) can be connected and synced
// independently — see PlaidConnect.jsx. cursor tracks each connection's
// own /transactions/sync progress.
let _plaidConnections = new Map();

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

  clear: () => {
    _splitwiseKey = null; _userId = null;
    _plaidConnections = new Map();
  },
};
