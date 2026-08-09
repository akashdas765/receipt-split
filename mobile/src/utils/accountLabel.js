// A user-set nickname always wins over Plaid's own name/mask — shared by
// PlaidConnect.jsx (the rename UI) and NetWorthDetail.jsx (the per-account
// balance breakdown), so the same account shows the same label everywhere.
export function accountLabel(acct) {
  if (!acct) return 'Account';
  if (acct.nickname) return acct.nickname;
  const name = acct.name || acct.official_name || 'Account';
  return acct.mask ? `${name} ...${acct.mask}` : name;
}
