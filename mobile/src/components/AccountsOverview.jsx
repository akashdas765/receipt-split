import React, { useState } from 'react';
import { X, Landmark, CreditCard, HelpCircle, ChevronRight } from 'lucide-react';
import { session } from '../services/session';
import { saveSourceMeta } from '../services/db';
import { formatCurrency } from '../utils/statementFormatters';

// "See everything, separated by bank vs credit card" — every connected/
// uploaded source (Plaid account, CSV/PDF upload, manual entries) grouped
// into Bank Accounts / Credit Cards / Uncategorized, each row showing this
// month's activity. Tapping a row drills into that one account's
// transactions (closes this sheet, sets StatementsPage's accountFilter).
//
// Only non-Plaid rows get a classify control here — Plaid accounts already
// have their own bank/credit toggle in PlaidConnect.jsx's chip UI (the
// authoritative store for those, plaidConnections/{itemId}.accounts[]);
// adding a second write path for the same accounts here would just create
// two places that could drift out of sync.
export default function AccountsOverview({ statements, monthlyTransactions, monthRange, onSelectAccount, onClose }) {
  // Local overrides so a classification made in this sheet reflects
  // immediately — session is a plain singleton, mutating it doesn't trigger
  // a re-render on its own (same reasoning as PlaidConnect.jsx's
  // refreshConnections pattern).
  const [overrides, setOverrides] = useState({});
  const getType = (sourceId) => overrides[sourceId] ?? session.getAccountType(sourceId);

  const classify = async (sourceId, accountType) => {
    setOverrides(prev => ({ ...prev, [sourceId]: accountType }));
    session.upsertSourceMeta(sourceId, { accountType });
    await saveSourceMeta(sourceId, { accountType });
  };

  const rows = statements.map(s => {
    const txns  = monthlyTransactions.filter(t => t.source === s.id);
    const total = txns.reduce((sum, t) => sum + (t.amount || 0), 0);
    return { ...s, isPlaid: s.id.startsWith('plaid-'), accountType: getType(s.id), count: txns.length, total };
  });
  const bank    = rows.filter(r => r.accountType === 'bank');
  const credit  = rows.filter(r => r.accountType === 'credit');
  const other   = rows.filter(r => !r.accountType);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="font-extrabold text-slate-800 text-sm">Accounts</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-4">
          {rows.length === 0 ? (
            <p className="text-center py-8 text-sm text-slate-400">No accounts connected or uploaded yet.</p>
          ) : (
            <>
              {bank.length > 0 && (
                <Section title="Bank Accounts" icon={<Landmark size={13} />}>
                  {bank.map(r => (
                    <AccountRow key={r.id} row={r} monthRange={monthRange} onSelect={onSelectAccount} />
                  ))}
                </Section>
              )}
              {credit.length > 0 && (
                <Section title="Credit Cards" icon={<CreditCard size={13} />}>
                  {credit.map(r => (
                    <AccountRow key={r.id} row={r} monthRange={monthRange} onSelect={onSelectAccount} />
                  ))}
                </Section>
              )}
              {other.length > 0 && (
                <Section title="Uncategorized" icon={<HelpCircle size={13} />}>
                  {other.map(r => (
                    <AccountRow key={r.id} row={r} monthRange={monthRange} onSelect={onSelectAccount} onClassify={r.isPlaid ? null : classify} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">
        {icon} {title}
      </p>
      <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50 px-3">
        {children}
      </div>
    </div>
  );
}

function AccountRow({ row, monthRange, onSelect, onClassify }) {
  return (
    <div className="flex items-center gap-2 py-2.5">
      {onClassify && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onClassify(row.id, 'bank')}
            title="Mark as bank account"
            className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
          >
            <Landmark size={13} />
          </button>
          <button
            onClick={() => onClassify(row.id, 'credit')}
            title="Mark as credit card"
            className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
          >
            <CreditCard size={13} />
          </button>
        </div>
      )}
      <button onClick={() => onSelect(row.id)} className="flex-1 flex items-center justify-between gap-2 text-left min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-700 truncate">{row.name}</p>
          <p className="text-[10px] text-slate-400">
            {row.count} transaction{row.count !== 1 ? 's' : ''} · {monthRange.label}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-sm font-bold text-slate-800">{formatCurrency(row.total)}</span>
          <ChevronRight size={14} className="text-slate-300" />
        </div>
      </button>
    </div>
  );
}
