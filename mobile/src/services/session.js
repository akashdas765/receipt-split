// In-memory store for the current user's Splitwise API key.
// Set on login/signup, cleared on logout.
let _splitwiseKey = null;
let _userId       = null;

export const session = {
  setKey:    (key) => { _splitwiseKey = key; },
  getKey:    ()    => _splitwiseKey,
  setUserId: (id)  => { _userId = id; },
  getUserId: ()    => _userId,
  clear:     ()    => { _splitwiseKey = null; _userId = null; },
};
