import React from 'react';
import { getCategoryIcon, getCategoryChartColor } from '../utils/categoryDetector';

// Thin surface-color gap between adjacent slices (percentage of the ring's
// pathLength) — the "surface gap" spacer from the dataviz skill's mark
// spec, so touching slices read as distinct without a border stroke.
const GAP_PCT = 1.2;

// Donut chart for "which category is eating the month" — every category
// gets its own slice and legend row, in the same descending-by-amount
// order the caller already sorted `categories` in (stats.topCategories).
// No top-N cap/fold: getCategoryChartColor's fixed 8-hue assignment (see
// categoryDetector.js) already falls back to a shared neutral gray for any
// category past its budget, so a long tail just reads as same-colored-but-
// distinctly-labeled rather than needing a synthetic "Other" bucket.
export default function CategoryDonut({ categories }) {
  const slices = categories.filter(c => c.amount > 0);
  const total = slices.reduce((s, c) => s + c.amount, 0);
  if (total <= 0) return null;

  const arcs = slices.reduce((acc, s) => {
    const pct = (s.amount / total) * 100;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].pct : 0;
    acc.push({ ...s, pct, offset });
    return acc;
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 px-4 py-4 border-b border-edge">
      <div className="relative w-32 h-32 shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {arcs.map(a => (
            <circle
              key={a.category}
              cx="50" cy="50" r="40"
              fill="none"
              stroke={getCategoryChartColor(a.category)}
              strokeWidth="16"
              pathLength="100"
              strokeDasharray={`${Math.max(a.pct - GAP_PCT, 0)} ${100 - Math.max(a.pct - GAP_PCT, 0)}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] text-subtle">This month</span>
          <span className="text-base font-extrabold text-ink">${total.toFixed(2)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 w-full">
        {arcs.map(a => (
          <div key={a.category} className="flex items-center gap-1.5 min-w-0 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: getCategoryChartColor(a.category) }}
            />
            <span className="truncate text-muted">{getCategoryIcon(a.category)} {a.category}</span>
            <span className="font-bold text-ink shrink-0 ml-auto">{Math.round(a.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
