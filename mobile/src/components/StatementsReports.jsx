import React, { useMemo } from 'react';
import { formatCurrency, groupByCategory } from '../utils/statementFormatters';
import { getCategoryColor, getCategoryIcon } from '../utils/categoryDetector';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';
const ORANGE  = '#ea580c';

// matched: full month's matched rows (including isSplitOnly). splitwiseOwed:
// sum of myOwedShare across all Splitwise expenses this month (whether or
// not they hit a bank transaction). personalTotal: unmatched bank spend.
export default function StatementsReports({ matched, splitwiseOwed, personalTotal, monthRange }) {
  const realSavings = useMemo(() =>
    matched.filter(t => !t.isSplitOnly).reduce((s, t) => s + (t.savings || 0), 0),
    [matched]
  );

  const totalSpend = splitwiseOwed + personalTotal;

  const { categoryData, categoryTotal } = useMemo(() => {
    const map  = groupByCategory(matched);
    const data = Object.entries(map)
      .map(([cat, { total }]) => ({ cat, total: parseFloat(total.toFixed(2)) }))
      .filter(d => d.total > 0)
      .sort((a, b) => b.total - a.total);
    return { categoryData: data.slice(0, 8), categoryTotal: data.reduce((s, d) => s + d.total, 0) };
  }, [matched]);

  const weeklyData = useMemo(() => {
    const weeks = {};
    for (const t of matched) {
      if (!t.date) continue;
      const d    = new Date(t.date);
      const week = `W${Math.ceil(d.getDate() / 7)}`;
      if (!weeks[week]) weeks[week] = { week, split: 0, personal: 0 };
      if (t.isSplitwised) weeks[week].split    += t.effectiveAmount || 0;
      else                weeks[week].personal += t.effectiveAmount || 0;
    }
    return Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));
  }, [matched]);

  const comparisonData = [
    { name: 'Splitwise share', value: splitwiseOwed, color: INDIGO },
    { name: 'Personal only',   value: personalTotal,  color: ORANGE },
    { name: 'Saved via split', value: realSavings,    color: EMERALD },
  ];
  const matchedCount = matched.filter(t => t.isSplitwised && !t.isSplitOnly).length;
  const bankCount    = matched.filter(t => !t.isSplitOnly).length;

  return (
    <div className="space-y-4">
      {/* Total spend banner */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Total spend — {monthRange.label}</p>
        <p className="text-3xl font-extrabold text-slate-800">{formatCurrency(totalSpend)}</p>
        <p className="text-xs text-slate-400 mt-1">
          {formatCurrency(splitwiseOwed)} splits + {formatCurrency(personalTotal)} personal
        </p>
      </div>

      {/* Split vs personal */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Split vs personal</p>
        <div className="space-y-3.5">
          {comparisonData.map(({ name, value, color }) => {
            const max = Math.max(...comparisonData.map(d => d.value), 1);
            const pct = (value / max) * 100;
            const pctOfTotal = totalSpend > 0 && name !== 'Saved via split' ? Math.round((value / totalSpend) * 100) : null;
            return (
              <div key={name}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-500">{name}</span>
                  <div className="flex items-center gap-2">
                    {pctOfTotal !== null && <span className="text-slate-400">{pctOfTotal}%</span>}
                    <span className="font-bold text-slate-800">{formatCurrency(value)}</span>
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">By category</p>
          <span className="text-xs text-slate-400">{formatCurrency(categoryTotal)} total</span>
        </div>
        {categoryData.length > 0 ? (
          <div className="space-y-2.5">
            {categoryData.map(({ cat, total }) => {
              const pct    = totalSpend > 0 ? Math.round((total / totalSpend) * 100) : 0;
              const barPct = categoryData[0]?.total > 0 ? (total / categoryData[0].total) * 100 : 0;
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: getCategoryColor(cat) }} />
                    <span className="text-slate-600 text-xs flex-1">{getCategoryIcon(cat)} {cat}</span>
                    <span className="text-slate-400 text-xs w-8 text-right">{pct}%</span>
                    <span className="text-slate-800 text-xs font-semibold w-16 text-right">{formatCurrency(total)}</span>
                  </div>
                  <div className="ml-4 h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barPct}%`, background: getCategoryColor(cat) }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-400 text-sm text-center py-6">No expense data yet</p>
        )}
      </div>

      {/* Weekly trend */}
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Weekly spending</p>
        {weeklyData.length > 0 ? (
          <div className="flex items-end gap-3 h-32">
            {weeklyData.map(w => {
              const max = Math.max(...weeklyData.map(x => x.split + x.personal), 1);
              return (
                <div key={w.week} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <div className="w-full rounded-t-lg overflow-hidden flex flex-col-reverse" style={{ height: `${Math.max(((w.split + w.personal) / max) * 100, 3)}%` }}>
                    <div style={{ height: `${w.split + w.personal > 0 ? (w.personal / (w.split + w.personal)) * 100 : 0}%`, background: ORANGE }} />
                    <div style={{ height: `${w.split + w.personal > 0 ? (w.split / (w.split + w.personal)) * 100 : 0}%`, background: INDIGO }} />
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold">{w.week}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-slate-400 text-sm text-center py-6">No transaction data yet</p>
        )}
        <div className="flex items-center gap-3 text-xs text-slate-400 mt-3">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: INDIGO }} />Split</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: ORANGE }} />Personal</span>
        </div>
      </div>

      {/* Savings insight */}
      <div className="rounded-2xl p-4 border border-emerald-100" style={{ background: 'linear-gradient(135deg, #ecfdf5, #f0fdfa)' }}>
        <p className="text-emerald-600 font-bold text-sm mb-2">💰 Savings insight</p>
        <p className="text-2xl font-extrabold text-slate-800">{formatCurrency(realSavings)}</p>
        <p className="text-xs text-slate-500 mt-1">saved in {monthRange.label} via Splitwise — only your fair share counted.</p>
        <p className="text-xs text-slate-400 mt-2">{matchedCount} of {bankCount} bank transactions matched to Splitwise</p>
      </div>
    </div>
  );
}
