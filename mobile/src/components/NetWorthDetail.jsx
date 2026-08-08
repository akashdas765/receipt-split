import React, { useState } from 'react';
import { X, Landmark, CreditCard, Users, Wallet, Pencil, Trash2, Plus, Check } from 'lucide-react';
import { formatCurrency } from '../utils/statementFormatters';

const INDIGO = '#6366f1';
const BLANK_FORM = { name: '', balance: '', type: 'asset' };

// Per-account net worth breakdown, opened by tapping the Net Worth card on
// HomePage. plaidBalances is the same flat list HomePage already computed
// totals from (label/institutionName included so each row can show which
// account it is, not just a lump sum). manualAccounts are entries with no
// transaction feed at all (rewards points, cash, a loan tracked by hand,
// ...) — added/edited/removed entirely from this sheet.
export default function NetWorthDetail({ netWorth, plaidBalances, splitwiseNet, manualAccounts, onSaveAccount, onDeleteAccount, onClose }) {
  const [formOpen,  setFormOpen]  = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form,       setForm]     = useState(BLANK_FORM);
  const [saving,      setSaving]  = useState(false);

  const bankAccounts   = plaidBalances.filter(b => b.accountType === 'bank'   && b.isoCurrencyCode === 'USD' && b.current != null);
  const creditAccounts = plaidBalances.filter(b => b.accountType === 'credit' && b.isoCurrencyCode === 'USD' && b.current != null);

  const startAdd = () => { setEditingId(null); setForm(BLANK_FORM); setFormOpen(true); };
  const startEdit = (acct) => {
    setEditingId(acct.id);
    setForm({ name: acct.name || '', balance: String(acct.balance ?? ''), type: acct.type === 'liability' ? 'liability' : 'asset' });
    setFormOpen(true);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    const balance = parseFloat(form.balance);
    if (!form.name.trim() || isNaN(balance)) return;
    setSaving(true);
    try {
      await onSaveAccount({ id: editingId || undefined, name: form.name.trim(), balance, type: form.type });
      setFormOpen(false);
      setForm(BLANK_FORM);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between">
          <div>
            <p className="font-extrabold text-slate-800 text-sm">Net Worth</p>
            <p className="text-xl font-extrabold text-slate-800 mt-0.5">{formatCurrency(netWorth)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-5">
          {bankAccounts.length > 0 && (
            <Section title="Bank accounts" icon={<Landmark size={13} />}>
              {bankAccounts.map(a => (
                <Row key={a.id} label={a.label} sub={a.institutionName} value={formatCurrency(a.current)} valueClass="text-slate-800" />
              ))}
            </Section>
          )}

          {creditAccounts.length > 0 && (
            <Section title="Credit cards" icon={<CreditCard size={13} />}>
              {creditAccounts.map(a => (
                <Row key={a.id} label={a.label} sub={a.institutionName} value={`-${formatCurrency(a.current)}`} valueClass="text-red-500" />
              ))}
            </Section>
          )}

          <Section title="Splitwise" icon={<Users size={13} />}>
            <Row
              label="Net balance"
              sub={splitwiseNet >= 0 ? 'Owed to you' : 'You owe'}
              value={`${splitwiseNet >= 0 ? '+' : ''}${formatCurrency(splitwiseNet)}`}
              valueClass={splitwiseNet >= 0 ? 'text-emerald-600' : 'text-red-500'}
            />
          </Section>

          <Section title="Other accounts" icon={<Wallet size={13} />}>
            {manualAccounts.length === 0 && !formOpen && (
              <p className="text-xs text-slate-400 py-1">No manual accounts yet — rewards points, cash, anything without a transaction feed.</p>
            )}
            {manualAccounts.map(a => (
              <div key={a.id} className="flex items-center justify-between py-1.5 group">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{a.name}</p>
                  <p className="text-[10px] text-slate-400">{a.type === 'liability' ? 'Liability' : 'Asset'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-semibold ${a.type === 'liability' ? 'text-red-500' : 'text-slate-800'}`}>
                    {a.type === 'liability' ? '-' : ''}{formatCurrency(a.balance)}
                  </span>
                  <button onClick={() => startEdit(a)} className="p-1 rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors">
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => onDeleteAccount(a.id)} className="p-1 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}

            {formOpen ? (
              <form onSubmit={submitForm} className="mt-2 space-y-2 bg-slate-50 rounded-xl p-3">
                <input
                  autoFocus
                  type="text"
                  placeholder="Account name (e.g. Chase Rewards)"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-indigo-300"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Balance"
                    value={form.balance}
                    onChange={e => setForm(f => ({ ...f, balance: e.target.value }))}
                    className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm outline-none focus:border-indigo-300"
                  />
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                    {['asset', 'liability'].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, type: t }))}
                        className={`px-3 text-xs font-semibold capitalize transition-colors ${form.type === t ? 'text-white' : 'bg-white text-slate-500'}`}
                        style={form.type === t ? { background: INDIGO } : {}}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setFormOpen(false); setForm(BLANK_FORM); setEditingId(null); }}
                    className="flex-1 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg py-2 hover:bg-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold text-white rounded-lg py-2 transition-colors disabled:opacity-60"
                    style={{ background: INDIGO }}
                  >
                    <Check size={12} /> {saving ? 'Saving…' : editingId ? 'Save' : 'Add'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={startAdd}
                className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold border-2 border-dashed border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
              >
                <Plus size={12} /> Add account
              </button>
            )}
          </Section>
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

function Row({ label, sub, value, valueClass }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="min-w-0">
        <p className="text-sm text-slate-700 truncate">{label}</p>
        {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
      </div>
      <span className={`text-sm font-semibold shrink-0 ${valueClass}`}>{value}</span>
    </div>
  );
}
