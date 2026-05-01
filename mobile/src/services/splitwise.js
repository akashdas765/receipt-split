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
  return (data.groups || []).map(g => ({
    id:      g.id,
    name:    g.name,
    members: displayNames(g.members || []).map(m => ({
      id:   m.id,
      name: m.name,
    })),
  }));
}

export async function postExpense({ description, groupId, paidById, personTotals, members }) {
  // personTotals: { memberId: amount } — only members who owe something
  const totalAmount = Object.values(personTotals).reduce((s, v) => s + v, 0);

  // Build form body manually (URLSearchParams not reliable in RN for this API)
  let body = `cost=${totalAmount.toFixed(2)}&description=${encodeURIComponent(description)}&group_id=${groupId}&currency_code=USD`;

  members.forEach((m, i) => {
    const owed = (personTotals[String(m.id)] || 0).toFixed(2);
    const paid = m.id === paidById ? totalAmount.toFixed(2) : '0.00';
    body += `&users__${i}__user_id=${m.id}`;
    body += `&users__${i}__owed_share=${owed}`;
    body += `&users__${i}__paid_share=${paid}`;
  });

  const res  = await swFetch('/create_expense', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.json();
}
