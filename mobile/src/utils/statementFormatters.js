// Date/currency helpers for the Statements feature. Adapted from
// akashdas765/personal-expense-manager's formatters.js, but reimplemented
// without date-fns — this codebase already does month math via plain
// Date/string ops elsewhere (see services/insights.js), so no new
// dependency is pulled in just for this.

export function formatCurrency(amount) {
  const n = parseFloat(amount);
  return `$${(isNaN(n) ? 0 : n).toFixed(2)}`;
}

export function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function pad(n) { return String(n).padStart(2, '0'); }
function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function getMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end   = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: iso(start),
    end:   iso(end),
    label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  };
}

// Sunday-start week range for a date string, e.g. "Aug 10 – Aug 16" — used
// to break a long date-descending transaction list into weekly sections
// (see HomePage's timeline). UTC throughout, same as formatShortDate, so a
// date string doesn't shift to the wrong week/day near midnight in a
// non-UTC timezone.
export function weekRangeLabel(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return 'Unknown date';
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const fmt = x => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

export function groupByCategory(transactions) {
  const map = {};
  for (const t of transactions) {
    const cat = t.category || 'Other';
    if (!map[cat]) map[cat] = { total: 0, count: 0 };
    map[cat].total += t.effectiveAmount ?? t.amount ?? 0;
    map[cat].count++;
  }
  return map;
}
