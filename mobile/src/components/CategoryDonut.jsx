import React from 'react';
import { getCategoryIcon, getCategoryChartColor, CHART_OTHER_COLOR } from '../utils/categoryDetector';

// Thin surface-color gap between adjacent slices (percentage of the ring's
// pathLength) — the "surface gap" spacer from the dataviz skill's mark
// spec, so touching slices read as distinct without a border stroke.
const GAP_PCT = 1.2;

// Donut chart for "which category is eating the month" at a glance —
// part-to-whole, not precise comparison (the clickable, dollar-labeled
// "By category" list below already covers that job). Capped at 5
// individually-colored slices + a folded "Other" wedge for the rest, per
// the dataviz skill's anti-patterns guidance (pie/donut only reads at
// ≤6 segments). categories: stats.topCategories, already sorted by
// amount descending.
export default function CategoryDonut({ categories }) {
  const top = categories.slice(0, 5);
  const restTotal = categories.slice(5).reduce((s, c) => s + c.amount, 0);
  const slices = restTotal > 0 ? [...top, { category: 'Other', amount: restTotal, isOther: true }] : top;
  const total = slices.reduce((s, c) => s + c.amount, 0);
  if (total <= 0) return null;

  const arcs = slices.reduce((acc, s) => {
    const pct = (s.amount / total) * 100;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].pct : 0;
    acc.push({ ...s, pct, offset });
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-5 px-4 py-4 border-b border-edge">
      <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0 -rotate-90">
        {arcs.map(a => (
          <circle
            key={a.category}
            cx="50" cy="50" r="40"
            fill="none"
            stroke={a.isOther ? CHART_OTHER_COLOR : getCategoryChartColor(a.category)}
            strokeWidth="16"
            pathLength="100"
            strokeDasharray={`${Math.max(a.pct - GAP_PCT, 0)} ${100 - Math.max(a.pct - GAP_PCT, 0)}`}
            strokeDashoffset={-a.offset}
          />
        ))}
      </svg>
      <div className="flex-1 min-w-0 space-y-1.5">
        {arcs.map(a => (
          <div key={a.category} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 min-w-0 text-muted">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: a.isOther ? CHART_OTHER_COLOR : getCategoryChartColor(a.category) }}
              />
              <span className="truncate">{a.isOther ? '📦' : getCategoryIcon(a.category)} {a.category}</span>
            </span>
            <span className="font-bold text-ink shrink-0">{Math.round(a.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
