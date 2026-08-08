import { session } from './session';

// Requests go through our Netlify proxy to avoid Splitwise CORS restrictions
const PROXY = '/.netlify/functions/splitwise';

const swFetch = (path, opts = {}) =>
  fetch(`${PROXY}?path=${encodeURIComponent(path)}`, {
    ...opts,
    headers: { 'x-splitwise-key': session.getKey(), ...(opts.headers || {}) },
  });

function displayNames(members) {
  const counts = {};
  members.forEach(m => {
    const fn = (m.first_name || '').trim().toLowerCase();
    counts[fn] = (counts[fn] || 0) + 1;
  });
  return members.map(m => {
    const fn = (m.first_name || '').trim();
    const ln = (m.last_name  || '').trim();
    const display = counts[fn.toLowerCase()] > 1 && ln
      ? `${fn} ${ln[0].toUpperCase()}`
      : fn;
    return { ...m, name: display };
  });
}

export async function fetchGroups() {
  const res  = await swFetch('/get_groups');
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || 'Could not load Splitwise groups.');
  return (data.groups || []).map(g => ({
    id:      g.id,
    name:    g.name,
    members: displayNames(g.members || []).map(m => ({
      id:   m.id,
      name: m.name,
    })),
  }));
}

// Used to identify which Splitwise member id is "me" so we can pull out the
// user's own share from a receipt's stored personTotals.
export async function fetchCurrentUser() {
  const res  = await swFetch('/get_current_user');
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || 'Could not load your Splitwise profile.');
  return { id: String(data.user.id), name: data.user.first_name };
}

// Your overall Splitwise position, live from Splitwise's own per-friend
// balances rather than summed from fetchAllExpenses (which is paginated
// and date-range-limited — not reliable for a true all-time total).
// Splitwise's sign convention already matches net worth's: positive =
// friends owe you (an asset), negative = you owe them (a liability) — used
// as-is by HomePage's net worth card, no sign flip needed. Non-USD
// balances are skipped so they don't silently corrupt the $ total, same
// as fetchAllExpenses's currency split.
export async function fetchNetBalance() {
  const res  = await swFetch('/get_friends');
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || 'Could not load your Splitwise balance.');
  let net = 0;
  for (const friend of data.friends || []) {
    for (const b of friend.balance || []) {
      if ((b.currency_code || 'USD') === 'USD') net += parseFloat(b.amount || 0);
    }
  }
  return net;
}

const SKIP_DESC = /settle|settlement|reimburs|payback|pay back|paid back/i;

// Full Splitwise expense history (not just receipts scanned through this
// app), enriched with the current user's paid/owed/net share of each —
// used by the Statements/bank-reconciliation feature to figure out which
// bank transactions are already covered by a Splitwise split. myId: the
// user's own Splitwise member id (see fetchCurrentUser).
export async function fetchAllExpenses(myId, { datedAfter, datedBefore, groupId } = {}) {
  const params = new URLSearchParams();
  if (datedAfter)  params.set('dated_after',  datedAfter);
  if (datedBefore) params.set('dated_before', datedBefore);
  if (groupId)     params.set('group_id',     String(groupId));
  params.set('limit', '500');

  const res  = await swFetch(`/get_expenses?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error || 'Could not load Splitwise expenses.');

  const rawExpenses = data.expenses || [];

  const allExpenses = rawExpenses
    .filter(e => !e.deleted_at && !e.payment && !SKIP_DESC.test(e.description || ''))
    .map(e => {
      const userShare = (e.users || []).find(u => String(u.user_id) === String(myId));
      return {
        id:            e.id,
        description:   e.description,
        cost:          parseFloat(e.cost),
        currency_code: e.currency_code || 'USD',
        date:          e.date,
        group_id:      e.group_id,
        category:      e.category?.name || 'Other',
        addedBy:       e.created_by?.first_name || null,
        myPaidShare:   parseFloat(userShare?.paid_share  || 0),
        myOwedShare:   parseFloat(userShare?.owed_share  || 0),
        myNetBalance:  parseFloat(userShare?.net_balance || 0),
        // Full per-member breakdown (not just the current user's own
        // share) — used by SplitwiseExpenseDetail's view-only detail sheet
        // to show who else is on the expense and what they paid/owe.
        splits: (e.users || []).map(u => ({
          id:         u.user_id,
          name:       [u.user?.first_name, u.user?.last_name].filter(Boolean).join(' ') || 'Someone',
          paidShare:  parseFloat(u.paid_share || 0),
          owedShare:  parseFloat(u.owed_share || 0),
        })),
      };
    });

  // Splitwise groups can mix currencies (e.g. a trip expense logged in
  // INR alongside everyday USD ones). Every $ total in this app — home
  // screen, Insights, Statements — assumes USD; blending in a foreign-
  // currency `cost` as if it were dollars would silently corrupt those
  // totals (a ₹3600 expense showing up as $3600). Split those out here so
  // every caller gets a safe-to-sum USD-only list by default, with the
  // excluded ones available separately for callers that want to surface
  // them (marked, not blended into totals) rather than just dropping them.
  const expenses              = allExpenses.filter(e => e.currency_code === 'USD');
  const otherCurrencyExpenses = allExpenses.filter(e => e.currency_code !== 'USD');

  // Payments *received* from others (e.g. a settle-up) — not an expense,
  // shown separately so it doesn't inflate spend totals.
  const paymentsReceived = rawExpenses
    .filter(e => !e.deleted_at && e.payment === true)
    .flatMap(e => {
      const userShare = (e.users || []).find(u => String(u.user_id) === String(myId));
      const received  = parseFloat(userShare?.owed_share || 0);
      if (received <= 0) return [];
      const payer = (e.users || []).find(u => parseFloat(u.paid_share || 0) > 0);
      return [{
        id:          e.id,
        description: e.description || 'Payment',
        amount:      received,
        date:        e.date,
        paidBy:      payer?.user?.first_name || 'Someone',
        group_id:    e.group_id,
      }];
    });

  return { expenses, otherCurrencyExpenses, paymentsReceived };
}

export async function postExpense({ description, details, groupId, paidAmounts = {}, personTotals, members, expenseId }) {
  // personTotals: { memberId: amount } — only members who owe something
  // paidAmounts:  { memberId: amount } — how much each payer contributed
  const totalAmount = Object.values(personTotals).reduce((s, v) => s + v, 0);

  let body = `cost=${totalAmount.toFixed(2)}&description=${encodeURIComponent(description)}&group_id=${groupId}&currency_code=USD`;
  if (details) body += `&details=${encodeURIComponent(details)}`;

  members.forEach((m, i) => {
    const owed = (personTotals[String(m.id)] || 0).toFixed(2);
    const paid = (paidAmounts[String(m.id)]  || 0).toFixed(2);
    body += `&users__${i}__user_id=${m.id}`;
    body += `&users__${i}__owed_share=${owed}`;
    body += `&users__${i}__paid_share=${paid}`;
  });

  // Re-posting an already-approved receipt updates the existing Splitwise
  // expense instead of creating a duplicate one.
  const path = expenseId ? `/update_expense/${expenseId}` : '/create_expense';
  const res  = await swFetch(path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();

  // Splitwise often returns HTTP 200 with an `errors` object instead of a
  // non-2xx status when it rejects the expense (bad group/user id,
  // validation failure, etc.) — without checking this, a rejected expense
  // looked identical to a successful one and the receipt got marked
  // "approved" even though nothing was posted.
  if (!res.ok || (data?.errors && Object.keys(data.errors).length > 0)) {
    const message = data?.errors
      ? Object.values(data.errors).flat().join(' ')
      : (data?.error || 'Splitwise rejected the expense.');
    throw new Error(message);
  }
  const expense = data?.expenses?.[0];
  if (!expense?.id) {
    throw new Error('Splitwise did not confirm the expense was created.');
  }

  return expense;
}
