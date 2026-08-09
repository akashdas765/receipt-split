import React, { useState, useMemo } from 'react';
import { Link2, Unlink, CheckCircle2, AlertCircle, Pencil, ChevronDown, ChevronUp, Sparkles, X, Check, Trash2, Clock, ArrowLeftRight, Plus } from 'lucide-react';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';

const INDIGO = '#6366f1';

// The Statements page's full card ledger — every transaction from a
// connected/uploaded card, credit or debit, in one place. Debit/expense
// rows (matched: bank rows only, isSplitOnly already filtered out by the
// caller, run through utils/matcher.js) keep the match-review workflow
// (link/unlink/confirm a Splitwise expense); credit rows (creditTxns —
// bill payments, refunds, never eligible for Splitwise matching) and
// pending rows (pendingTxns — not yet posted, amount not final, also never
// matched) are listed alongside them as simple, non-expandable entries.
// Previously two separate tabs (Review + All) — merged here so "all my
// card activity" and "what still needs matching" live in one list instead
// of two.
export default function TransactionsList({ matched, creditTxns, pendingTxns = [], accountSummary, groupName, monthRange, onLink, onAddNew, onUnlink, onClearOverride, onConfirmSuggestion, onDelete }) {
  const [filter,   setFilter]   = useState(0); // 0=All 1=Unmatched 2=Matched 3=Credits 4=Pending
  const [expanded, setExpanded] = useState({});

  // Transfers are neither — they're excluded from both (matcher.js never
  // even tries to score them), but stay visible in the "All" view (which
  // renders straight off `matched`, unfiltered) with their own distinct
  // row treatment (see DebitRow's isTransfer branch below).
  const matchedTxns   = matched.filter(t => t.isSplitwised && !t.isTransfer);
  const unmatchedTxns = matched.filter(t => !t.isSplitwised && !t.isTransfer);
  const suggestedCount = unmatchedTxns.filter(t => t.suggestedMatch).length;
  const displayed =
    filter === 1 ? unmatchedTxns :
    filter === 2 ? matchedTxns :
    (filter === 3 || filter === 4) ? [] :
    matched;
  const showCredits = filter === 0 || filter === 3;
  const showPending = filter === 0 || filter === 4;

  // "All" interleaves every kind into one date-ordered list instead of
  // three stacked blocks (all credits, then all pending, then all debits)
  // — each individual array is already date-desc (matcher.js sorts
  // `matched`, and creditTxns/pendingTxns inherit loadTransactions()'s own
  // orderBy('date','desc')), but stacking three separately-sorted blocks
  // isn't the same as one list actually in date order. Only built/used for
  // filter===0 — every other filter already shows exactly one kind, so
  // there's nothing to interleave.
  const combinedAll = useMemo(() => {
    if (filter !== 0) return [];
    const items = [
      ...creditTxns.map(t => ({ t, kind: 'credit' })),
      ...pendingTxns.map(t => ({ t, kind: 'pending' })),
      ...matched.map(t => ({ t, kind: 'debit' })),
    ];
    items.sort((a, b) => (b.t.date || '').localeCompare(a.t.date || ''));
    return items;
  }, [filter, creditTxns, pendingTxns, matched]);

  // Splitwise savings is a separate concept from the Debit/Credit/Net
  // summary below (which reads like a real bank statement) — shown as its
  // own small callout instead of being the headline number, since
  // conflating "what I actually owe after splits" with "total money that
  // moved" is exactly what made the old balance card misleading (it only
  // ever summed debit/matched rows, silently ignoring every credit).
  const savedTotal = matchedTxns.reduce((s, t) => s + (t.savings || 0), 0);

  if (!matched.length && !creditTxns.length && !pendingTxns.length) {
    return (
      <div className="text-center py-10 text-sm text-slate-400">
        <p>Upload a bank statement first,</p>
        <p className="mt-1">then come back here to see your transactions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {accountSummary && (
        <>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide -mb-1">{monthRange.label}</p>
          <SummaryCard title={accountSummary.title} kind={accountSummary.type} data={accountSummary} />
          {savedTotal > 0.5 && (
            <p className="text-xs text-emerald-600 font-semibold">-{formatCurrency(savedTotal)} saved via Splitwise splits</p>
          )}
          <p className="text-xs text-slate-400">
            {matchedTxns.length} matched · {unmatchedTxns.length} unmatched · {creditTxns.length} credit{creditTxns.length !== 1 ? 's' : ''}
            {pendingTxns.length > 0 && <> · {pendingTxns.length} pending</>}
          </p>
        </>
      )}

      {/* Filter chips — wraps instead of scrolling horizontally */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: 'All', value: matched.length + creditTxns.length + pendingTxns.length, active: filter === 0, onClick: () => setFilter(0), color: 'text-slate-800' },
          { label: '✅ Matched', value: matchedTxns.length, active: filter === 2, onClick: () => setFilter(2), color: 'text-emerald-500' },
          { label: '⚠️ Unmatched', value: unmatchedTxns.length, active: filter === 1, onClick: () => setFilter(1), color: 'text-amber-500' },
          { label: '💳 Credits', value: creditTxns.length, active: filter === 3, onClick: () => setFilter(3), color: 'text-emerald-500' },
          ...(pendingTxns.length > 0 ? [{ label: '🕒 Pending', value: pendingTxns.length, active: filter === 4, onClick: () => setFilter(4), color: 'text-slate-500' }] : []),
        ].map(c => (
          <button key={c.label} onClick={c.onClick}
            className={`flex-1 min-w-[70px] rounded-xl px-1.5 py-2.5 text-center border transition-colors ${c.active ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
            <p className={`font-extrabold text-sm ${c.color}`}>{c.value}</p>
            <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{c.label}</p>
          </button>
        ))}
      </div>

      {filter === 0 && suggestedCount > 0 && (
        <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: INDIGO }}>
          <Sparkles size={12} /> {suggestedCount} possible match{suggestedCount !== 1 ? 'es' : ''} found — tap to review
        </p>
      )}
      {filter === 0 && unmatchedTxns.length > 0 && (
        <p className="text-xs text-slate-400">
          Tap <span className="font-semibold" style={{ color: INDIGO }}>Link</span> on any unmatched transaction to connect it to a Splitwise expense.
        </p>
      )}

      {/* Transaction list */}
      <div className="space-y-2">
        {filter === 0 ? (
          combinedAll.map(({ t, kind }) => (
            kind === 'credit' ? <CreditRow key={t.id} txn={t} onDelete={onDelete} /> :
            kind === 'pending' ? <PendingRow key={t.id} txn={t} onDelete={onDelete} /> :
            <DebitRow key={t.id} txn={t} isOpen={!!expanded[t.id]} setExpanded={setExpanded}
              groupName={groupName} onLink={onLink} onAddNew={onAddNew} onUnlink={onUnlink} onClearOverride={onClearOverride}
              onConfirmSuggestion={onConfirmSuggestion} onDelete={onDelete} />
          ))
        ) : (
          <>
            {showCredits && creditTxns.map(txn => <CreditRow key={txn.id} txn={txn} onDelete={onDelete} />)}
            {showPending && pendingTxns.map(txn => <PendingRow key={txn.id} txn={txn} onDelete={onDelete} />)}
            {displayed.map(txn => (
              <DebitRow key={txn.id} txn={txn} isOpen={!!expanded[txn.id]} setExpanded={setExpanded}
                groupName={groupName} onLink={onLink} onAddNew={onAddNew} onUnlink={onUnlink} onClearOverride={onClearOverride}
                onConfirmSuggestion={onConfirmSuggestion} onDelete={onDelete} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function CreditRow({ txn, onDelete }) {
  // Same "hint here, confirm in its own tab" pattern as isTransfer below —
  // a "payment thank you"-style credit needs a tap in the Payments tab
  // before it stops counting toward the card's credit total.
  const needsConfirm = txn.paymentNeedsConfirm;
  return (
    <div className={`rounded-2xl border bg-white p-3 flex items-center gap-3 ${needsConfirm ? 'border-amber-100' : 'border-emerald-100'}`}>
      <span className="text-base shrink-0">💳</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {txn.transferHintLabel && <ArrowLeftRight size={11} style={{ color: INDIGO }} className="shrink-0" />}
          <p className="text-sm font-semibold text-slate-700 truncate">{txn.transferHintLabel || txn.description}</p>
        </div>
        {txn.transferHintLabel && <p className="text-xs text-slate-500 mt-0.5 truncate">{txn.description}</p>}
        <p className="text-xs text-slate-400 mt-0.5 truncate">{formatShortDate(txn.date)} · {txn.sourceName || txn.source}</p>
        {needsConfirm && <p className="text-xs text-amber-500 mt-0.5">Possible bill payment — confirm in the Payments tab</p>}
      </div>
      <p className="text-sm font-bold text-emerald-500 shrink-0">+{formatCurrency(txn.amount)}</p>
      <button onClick={() => onDelete(txn.id)} className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function PendingRow({ txn, onDelete }) {
  return (
    <div className="rounded-2xl border border-slate-200 border-dashed bg-white p-3 flex items-center gap-3">
      <Clock size={16} className="text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-slate-600 truncate">{txn.description}</p>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 rounded-full shrink-0">Pending</span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5 truncate">{formatShortDate(txn.date)} · {txn.sourceName || txn.source}</p>
      </div>
      <p className="text-sm font-bold text-slate-500 shrink-0">-{formatCurrency(txn.amount)}</p>
      <button onClick={() => onDelete(txn.id)} className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function DebitRow({ txn, isOpen, setExpanded, groupName, onLink, onAddNew, onUnlink, onClearOverride, onConfirmSuggestion, onDelete }) {
  const isOverridden = txn.manualOverride;
  const suggestion   = !txn.isSplitwised ? txn.suggestedMatch : null;

  return (
    <div className={`rounded-2xl overflow-hidden border bg-white ${
      txn.isTransfer ? 'border-indigo-100' : txn.isSplitwised ? 'border-emerald-100' : suggestion ? 'border-indigo-100' : 'border-amber-100'
    }`}>
      <div className="w-full flex items-center gap-2 p-3">
        <button className="flex-1 flex items-center gap-3 text-left min-w-0" onClick={() => setExpanded(p => ({ ...p, [txn.id]: !p[txn.id] }))}>
          <div className="shrink-0">
            {txn.isTransfer
              ? <ArrowLeftRight size={18} style={{ color: INDIGO }} />
              : txn.isSplitwised
                ? <CheckCircle2 size={18} className="text-emerald-500" />
                : suggestion
                  ? <Sparkles size={18} style={{ color: INDIGO }} />
                  : <AlertCircle size={18} className="text-amber-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {txn.transferHintLabel ? <ArrowLeftRight size={12} style={{ color: INDIGO }} className="shrink-0" /> : <span className="text-sm">{getCategoryIcon(txn.category)}</span>}
              <p className="text-sm font-semibold text-slate-700 truncate">{txn.transferHintLabel || txn.description}</p>
              {isOverridden && <span className="text-xs bg-indigo-50 px-1.5 rounded-full shrink-0" style={{ color: INDIGO }}>manual</span>}
            </div>
            {txn.transferHintLabel && <p className="text-xs text-slate-500 mt-0.5 truncate">{txn.description}</p>}
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {formatShortDate(txn.date)} · {txn.sourceName || txn.source}
              {txn.isSplitwised && (
                <span className="ml-1.5 text-emerald-500">
                  · {txn.splitwiseDesc}{groupName(txn.groupId) ? ` · ${groupName(txn.groupId)}` : ''}
                </span>
              )}
              {suggestion && (
                <span className="ml-1.5 font-semibold" style={{ color: INDIGO }}>
                  · looks like {suggestion.expense.description} ({suggestion.score}%)
                </span>
              )}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-slate-800">-{formatCurrency(txn.effectiveAmount)}</p>
            {txn.isSplitwised && txn.savings > 0.5 && <p className="text-xs text-emerald-500">-{formatCurrency(txn.savings)}</p>}
          </div>
          {isOpen ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
        </button>
        <button onClick={() => onDelete(txn.id)} className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2 space-y-2">
          {txn.postedDate && (
            <div className="flex justify-between text-xs px-0.5">
              <span className="text-slate-400">Posted</span>
              <span className="text-slate-500">{formatShortDate(txn.postedDate)}</span>
            </div>
          )}
          {txn.isTransfer ? (
            <div className="rounded-xl p-2.5" style={{ background: '#eef1fb' }}>
              <p className="text-xs flex items-center gap-1.5" style={{ color: INDIGO }}>
                <ArrowLeftRight size={12} /> Money between your own accounts — not spend, not Splitwise-matchable.
              </p>
              <p className="text-xs text-slate-500 mt-1">Confirm or dismiss it from the Transfers tab.</p>
            </div>
          ) : txn.isSplitwised ? (
            <div className="bg-emerald-50 rounded-xl p-2.5 space-y-1">
              <p className="text-emerald-600 text-xs font-semibold">✅ Matched to Splitwise</p>
              <Row label="Expense" value={txn.splitwiseDesc} />
              {txn.splitwiseDate && <Row label="Date" value={formatShortDate(txn.splitwiseDate)} />}
              {txn.splitwiseCost != null && <Row label="Total cost" value={formatCurrency(txn.splitwiseCost)} />}
              <Row label="Your share" value={formatCurrency(txn.effectiveAmount)} valueClass="text-emerald-600 font-semibold" />
              <Row label="You save" value={`-${formatCurrency(txn.savings)}`} valueClass="text-emerald-600" />
              {groupName(txn.groupId) && <Row label="Group" value={groupName(txn.groupId)} />}
              {!txn.manualOverride && <Row label="Confidence" value={`${txn.matchScore}%`} />}
            </div>
          ) : suggestion ? (
            <div className="rounded-xl p-2.5 space-y-1" style={{ background: '#eef1fb' }}>
              <p className="text-xs font-semibold flex items-center gap-1" style={{ color: INDIGO }}>
                <Sparkles size={12} /> Possible match
              </p>
              <Row label="Expense" value={suggestion.expense.description} />
              {suggestion.expense.date && <Row label="Date" value={formatShortDate(suggestion.expense.date)} />}
              <Row label="Your share" value={formatCurrency(suggestion.expense.myOwedShare)} valueClass="font-semibold" />
              {groupName(suggestion.expense.group_id) && <Row label="Group" value={groupName(suggestion.expense.group_id)} />}
              <Row label="Confidence" value={`${suggestion.score}%`} />
            </div>
          ) : (
            <div className="bg-amber-50 rounded-xl p-2.5">
              <p className="text-amber-600 text-xs">No Splitwise match — full amount counts as personal expense.</p>
            </div>
          )}

          {!txn.isTransfer && (
          <div className="flex gap-2 pt-1">
            {txn.isSplitwised ? (
              <>
                <button onClick={() => { onUnlink(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-600 border border-amber-200 rounded-xl py-2 hover:bg-amber-50 transition-colors">
                  <Unlink size={13} /> Unlink
                </button>
                <button onClick={() => { onLink(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border rounded-xl py-2 transition-colors" style={{ color: INDIGO, borderColor: '#c7d2fe' }}>
                  <Pencil size={13} /> Change link
                </button>
              </>
            ) : suggestion ? (
              <>
                <button onClick={() => { onUnlink(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl py-2 hover:bg-slate-50 transition-colors">
                  <X size={13} /> Not this
                </button>
                <button onClick={() => { onConfirmSuggestion(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-white rounded-xl py-2 transition-colors" style={{ background: INDIGO }}>
                  <Check size={13} /> Confirm match
                </button>
              </>
            ) : (
              <>
                <button onClick={() => { onLink(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold border rounded-xl py-2 transition-colors" style={{ color: INDIGO, borderColor: '#c7d2fe' }}>
                  <Link2 size={13} /> Link to Splitwise
                </button>
                <button onClick={() => { onAddNew(txn); setExpanded(p => ({ ...p, [txn.id]: false })); }}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-white rounded-xl py-2 transition-colors" style={{ background: INDIGO }}>
                  <Plus size={13} /> Add to Splitwise
                </button>
                {isOverridden && (
                  <button onClick={() => onClearOverride(txn)} className="flex items-center justify-center gap-1 text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50 transition-colors">
                    Auto
                  </button>
                )}
              </>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, valueClass = 'text-slate-700' }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

// Reads like a real bank/card statement — every debit counted, every
// credit counted (transfers included on whichever side they actually
// moved), instead of the old card's "sum of matched debit rows only,"
// which silently treated every credit as if it didn't exist. `kind`
// picks the one extra line that's actually meaningful for that account
// type: a bank account's "Transfers" vs. a card's "Payments made"
// (bill payments specifically, not merchant refunds — see
// StatementsPage.jsx's accountSummary for how that's told apart).
function SummaryCard({ title, kind, data }) {
  const netPositive = data.net >= 0;
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">{title}</p>
        <p className={`text-sm font-extrabold ${netPositive ? 'text-emerald-600' : 'text-red-500'}`}>
          {netPositive ? '+' : ''}{formatCurrency(data.net)} net
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="bg-red-50 rounded-xl px-3 py-2">
          <p className="text-base font-bold text-red-500">-{formatCurrency(data.debit)}</p>
          <p className="text-[10px] text-slate-400">Debit</p>
        </div>
        <div className="bg-emerald-50 rounded-xl px-3 py-2">
          <p className="text-base font-bold text-emerald-600">+{formatCurrency(data.credit)}</p>
          <p className="text-[10px] text-slate-400">Credit</p>
        </div>
      </div>
      {kind === 'bank' ? (
        <p className="text-xs text-slate-500">Transfers <span className="font-semibold text-slate-700">{formatCurrency(data.transfers)}</span></p>
      ) : (
        <p className="text-xs text-slate-500">Payments made <span className="font-semibold text-slate-700">{formatCurrency(data.payments)}</span></p>
      )}
    </div>
  );
}
