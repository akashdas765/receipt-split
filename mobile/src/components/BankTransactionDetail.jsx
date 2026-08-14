import React from 'react';
import { X, Calendar, Landmark, Tag, ArrowUpRight } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { ALL_CATEGORIES, getCategoryIcon, TRANSFER_CATEGORY, TRANSFER_CATEGORY_ICON } from '../utils/categoryDetector';

// Detail sheet for a bank transaction — same view+inline-category-edit
// shape as ReceiptDetail/SplitwiseExpenseDetail, shared between
// InsightsPage's category/merchant drill-down AND StatementsPage's own
// StatBreakdown drill-down, so a transaction card looks and behaves the
// same wherever it's opened from. Deliberately doesn't attempt to
// replicate Statements' full match-review workflow (link/unlink a
// Splitwise expense, confirm a suggestion, delete) — that machinery
// (SplitwisePickerModal, AddToSplitwiseModal, etc.) lives entirely in
// StatementsPage's own state, and duplicating it here would mean two
// places that can drift. Instead: view the transaction, edit its category
// inline, and an escape hatch for anything beyond that — actionLabel/
// onAction are caller-supplied since what "more" means differs: Insights
// navigates cross-page to Statements (openTxnId deep-link), Statements
// itself just closes this card and expands/scrolls to the row already
// on-screen. Omit both to hide the button entirely.
export default function BankTransactionDetail({ txn, matchLabel, onChangeCategory, actionLabel, onAction, onClose }) {
  // A card payment or a transfer between the user's own accounts isn't a
  // real spending category — both are already excluded from every spend/
  // category total elsewhere in the app (see insights.js's bankExpenseTxns
  // filter, matcher.js's isPayment/isTransfer handling). Showing the
  // editable ALL_CATEGORIES dropdown for one just offered a meaningless
  // choice that silently defaulted to "Other" (detectCategory has no way
  // to recognize "Payment to Chase card ending in 3358" as anything). A
  // static label instead — not editable, since there's nothing sensible to
  // change it to.
  const specialCategory = txn.isTransfer ? '🔁 Transfer' : txn.isPayment ? '💳 Card Payment' : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-extrabold text-ink text-sm truncate">{txn.description || 'Transaction'}</p>
            <p className="text-xl font-extrabold text-ink mt-0.5">{formatCurrency(txn.amount)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-4">
          <div className="bg-surface rounded-xl border border-edge divide-y divide-slate-50 px-3">
            <Row icon={<Calendar size={13} />} label="Date" value={formatShortDate(txn.date)} />
            <Row icon={<Landmark size={13} />} label="Account" value={txn.sourceName || txn.source || 'Unknown'} />
            {specialCategory ? (
              <Row icon={<Tag size={13} />} label="Category" value={specialCategory} />
            ) : (
              <div className="flex items-center justify-between py-2.5 gap-3">
                <span className="flex items-center gap-1.5 text-sm text-muted shrink-0"><Tag size={13} />Category</span>
                <select
                  value={txn.category || 'Other'}
                  onChange={e => onChangeCategory(txn, e.target.value)}
                  className="text-sm font-semibold text-ink bg-transparent outline-none text-right min-w-0"
                >
                  {ALL_CATEGORIES.map(cat => <option key={cat} value={cat}>{getCategoryIcon(cat)} {cat}</option>)}
                  <option value={TRANSFER_CATEGORY}>{TRANSFER_CATEGORY_ICON} {TRANSFER_CATEGORY}</option>
                </select>
              </div>
            )}
            {matchLabel && <Row label="Splitwise" value={matchLabel} />}
          </div>

          {onAction && (
            <>
              <button
                onClick={onAction}
                className="w-full flex items-center justify-center gap-2 text-sm font-bold text-white py-3 rounded-xl btn-gradient btn-press"
              >
                {actionLabel || 'Open in Statements'} <ArrowUpRight size={15} />
              </button>
              <p className="text-[10px] text-subtle text-center -mt-2">Link to Splitwise, unlink, or delete from there</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="flex items-center gap-1.5 text-sm text-muted">{icon}{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
