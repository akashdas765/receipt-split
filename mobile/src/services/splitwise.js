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

export async function postExpense({ description, details, groupId, paidAmounts = {}, personTotals, members }) {
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

  const res  = await swFetch('/create_expense', {
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
