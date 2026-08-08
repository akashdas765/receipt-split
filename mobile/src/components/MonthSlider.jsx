import React, { useRef, useEffect } from 'react';

const INDIGO = '#6366f1';
const MONTHS_WINDOW = 12; // trailing window shown

function isSameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

// Trailing 12 months, oldest first — "today" is always the last
// (rightmost, auto-scrolled-to) option. Shared by Home, Statements, and
// Insights so month navigation looks and behaves identically everywhere.
export default function MonthSlider({ currentMonth, onChange }) {
  const sliderRef = useRef(null);

  const monthOptions = React.useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTHS_WINDOW }, (_, i) =>
      new Date(now.getFullYear(), now.getMonth() - (MONTHS_WINDOW - 1 - i), 1)
    );
  }, []);

  useEffect(() => {
    sliderRef.current?.scrollTo({ left: sliderRef.current.scrollWidth });
  }, []);

  return (
    <div className="sticky top-14 z-10 glass border-t border-slate-100/60">
      <div ref={sliderRef} className="max-w-2xl mx-auto flex gap-2 overflow-x-auto px-4 py-2.5">
        {monthOptions.map(d => {
          const selected = isSameMonth(d, currentMonth);
          return (
            <button
              key={d.toISOString()}
              onClick={() => onChange(d)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors btn-press ${selected ? 'text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-200'}`}
              style={selected ? { background: INDIGO } : {}}
            >
              {d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
