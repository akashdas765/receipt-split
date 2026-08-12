import React, { useState } from 'react';
import { X } from 'lucide-react';
import { formatCurrency } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';
import CategoryDetail from './CategoryDetail';

// Breakdown sheet opened by tapping the Spending card on HomePage — the
// same Loan Payments / Rent & Utilities / Expenses / Splitwise split shown
// on the card face. Every section lists transactions by CATEGORY first
// (not flat — a section like Expenses can span 8+ categories, and a flat
// list of everything sorted by amount just reads as noise), tapping a
// category opens the same CategoryDetail sheet InsightsPage's "By
// category" list uses to drill into the actual transactions, reusing its
// own onSelect to route through to the real edit sheet
// (ReceiptDetail/SplitwiseExpenseDetail/BankTransactionDetail — see
// HomePage's handleSelectSpendingItem/handleSelectSplitwiseItem). The
// Splitwise section needs its own onSelect (a different detail sheet than
// the other three) — openCategory carries a `kind` tag so the nested
// CategoryDetail knows which handler to call once a transaction inside it
// is picked. Category order is always highest-total-first (matches the
// donut on Insights); CategoryDetail carries its own independent
// Amount/Date toggle for the drill-down list, so there's no page-level
// sort control here anymore.
export default function SpendingDetail({ total, subtitle, loanTxns = [], loanTotal = 0, rentUtilTxns, rentUtilTotal, miscTxns, miscTotal, splitwiseTxns = [], splitwiseTotal = 0, onSelect, onSelectSplitwise, onClose }) {
  const [openCategory, setOpenCategory] = useState(null); // { category, total, items, kind } | null

  const activeOnSelect = openCategory?.kind === 'splitwise' ? onSelectSplitwise : onSelect;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge flex items-start justify-between">
          <div>
            <p className="font-extrabold text-ink text-sm">Actual spend</p>
            <p className="text-xl font-extrabold text-ink mt-0.5">{formatCurrency(total)}</p>
            {subtitle && <p className="text-xs text-subtle mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-5">
          {loanTxns.length > 0 && (
            <CategorySection title="Loan Payments" total={loanTotal} txns={loanTxns} kind="spend" onSelectCategory={setOpenCategory} />
          )}
          <CategorySection title="Rent & Utilities" total={rentUtilTotal} txns={rentUtilTxns} kind="spend" onSelectCategory={setOpenCategory} />
          <CategorySection title="Expenses" total={miscTotal} txns={miscTxns} kind="spend" onSelectCategory={setOpenCategory} />
          {splitwiseTxns.length > 0 && (
            <div>
              <CategorySection title="Splitwise · paid by someone else" total={splitwiseTotal} txns={splitwiseTxns} kind="splitwise" onSelectCategory={setOpenCategory} />
              <p className="text-[10px] text-subtle mt-1.5">Paid directly by someone else, not out of your bank account — still counted in Actual spend above since it&rsquo;s your share of real money spent.</p>
            </div>
          )}
        </div>
      </div>

      {openCategory && (
        <CategoryDetail
          category={openCategory.category}
          total={openCategory.total}
          items={openCategory.items}
          onClose={() => setOpenCategory(null)}
          onSelect={activeOnSelect ? item => { setOpenCategory(null); activeOnSelect(item); } : undefined}
        />
      )}
    </div>
  );
}

// Groups txns by category (fallback 'Other'), highest-total-first — same
// convention the Insights donut uses. Each category row hands its own
// {category, total, items, kind} to onSelectCategory (SpendingDetail's
// openCategory state) — kind says which onSelect handler the nested
// CategoryDetail should use once a transaction in that category is
// picked. items reshaped to the {amount, source} field names CategoryDetail
// expects (this section's txns use effectiveAmount/sourceName instead,
// since that's this app's own convention for "your share" elsewhere —
// reshaping happens here rather than changing CategoryDetail itself, which
// InsightsPage already relies on with its own field names).
function CategorySection({ title, total, txns, kind, onSelectCategory }) {
  const byCategory = {};
  for (const t of txns) {
    const cat = t.category || 'Other';
    (byCategory[cat] || (byCategory[cat] = [])).push(t);
  }
  const categories = Object.entries(byCategory)
    .map(([category, items]) => ({
      category,
      items,
      total: items.reduce((s, t) => s + (t.effectiveAmount || 0), 0),
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-bold text-subtle uppercase tracking-wide">{title}</p>
        <p className="text-xs font-bold text-ink">{formatCurrency(total)}</p>
      </div>
      {categories.length === 0 ? (
        <p className="text-xs text-subtle py-2">Nothing here</p>
      ) : (
        <div className="bg-surface rounded-xl border border-edge divide-y divide-slate-50 px-3">
          {categories.map(c => (
            <button
              key={c.category}
              onClick={() => onSelectCategory({
                category: c.category,
                total: c.total,
                kind,
                items: c.items.map(t => ({ ...t, amount: t.effectiveAmount, source: t.sourceName || t.source })),
              })}
              className="w-full flex items-center justify-between py-2 gap-3 text-left hover:bg-surface-alt -mx-3 px-3 rounded-lg transition-colors"
            >
              <span className="text-sm text-ink truncate">
                {getCategoryIcon(c.category)} {c.category}
                <span className="text-[10px] text-subtle font-normal"> · {c.items.length} item{c.items.length !== 1 ? 's' : ''}</span>
              </span>
              <span className="text-sm font-semibold text-ink shrink-0">{formatCurrency(c.total)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
