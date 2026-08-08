// In-memory store for the current user's Splitwise API key and Plaid bank
// connection. Set on login/signup, cleared on logout.
let _splitwiseKey = null;
let _userId       = null;

// Plaid: accessToken is per-connected-account (one Chase card, for now —
// see PlaidConnect.jsx), cursor tracks /transactions/sync progress so
// re-syncing only pulls what's changed since last time.
let _plaidAccessToken     = null;
let _plaidItemId          = null;
let _plaidCursor          = null;
let _plaidInstitutionName = null;

export const session = {
  setKey:    (key) => { _splitwiseKey = key; },
  getKey:    ()    => _splitwiseKey,
  setUserId: (id)  => { _userId = id; },
  getUserId: ()    => _userId,

  // Partial update — only fields explicitly passed (not undefined) change,
  // so e.g. session.setPlaid({ cursor }) after a sync doesn't clobber the
  // already-stored accessToken/institutionName.
  setPlaid: ({ accessToken, itemId, cursor, institutionName } = {}) => {
    if (accessToken     !== undefined) _plaidAccessToken     = accessToken;
    if (itemId          !== undefined) _plaidItemId          = itemId;
    if (cursor          !== undefined) _plaidCursor          = cursor;
    if (institutionName !== undefined) _plaidInstitutionName = institutionName;
  },
  getPlaid: () => ({
    accessToken:     _plaidAccessToken,
    itemId:          _plaidItemId,
    cursor:          _plaidCursor,
    institutionName: _plaidInstitutionName,
  }),

  clear: () => {
    _splitwiseKey = null; _userId = null;
    _plaidAccessToken = null; _plaidItemId = null; _plaidCursor = null; _plaidInstitutionName = null;
  },
};
