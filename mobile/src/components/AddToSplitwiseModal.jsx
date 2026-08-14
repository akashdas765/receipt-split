import React, { useState, useMemo } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import { postExpense } from '../services/splitwise';
import { memberColor } from '../utils/memberColor';
import { formatCurrency, formatShortDate } from '../utils/statementFormatters';

const INDIGO = '#6366f1';

// Same remainder-onto-first-share trick as ApprovePage's equalSplit, kept
// as plain numbers (not .toFixed strings) since postExpense's own
// personTotals/paidAmounts handling calls .toFixed(2) on each value itself.
function equalSplit(total, ids) {
  if (!ids.length) return {};
  const each      = Math.floor(total * 100 / ids.length) / 100;
  const remainder = Math.round((total - each * ids.length) * 100) / 100;
  return Object.fromEntries(ids.map((id, i) => [id, i === 0 ? each + remainder : each]));
}

// Creates a brand-new Splitwise expense straight from an unmatched bank
// transaction — the counterpart to SplitwisePickerModal (which links to an
// EXISTING expense instead of making one). onPosted(expense, groupId) is
// called with the created expense so the caller can link the transaction
// to it, same as picking an existing one already does.
export default function AddToSplitwiseModal({ transaction, myId, groups, onPosted, onClose }) {
  const amount = Math.abs(transaction.amount || 0);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? null);
  const [description, setDescription] = useState(transaction.description || '');
  const group = groups.find(g => g.id === groupId);

  const [owedIds, setOwedIds] = useState(() => (groups[0]?.members || []).map(m => String(m.id)));
  const [payerIds, setPayerIds] = useState(() => (myId ? [String(myId)] : []));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectGroup = id => {
    setGroupId(id);
    const g = groups.find(x => x.id === id);
    const memberIds = (g?.members || []).map(m => String(m.id));
    setOwedIds(memberIds);
    setPayerIds(myId && memberIds.includes(String(myId)) ? [String(myId)] : []);
    setError('');
  };

  const toggleOwed = id => {
    const sid = String(id);
    setOwedIds(prev => prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]);
  };
  const togglePayer = id => {
    const sid = String(id);
    setPayerIds(prev => prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]);
  };

  const owedShares = useMemo(() => equalSplit(amount, owedIds),  [amount, owedIds]);
  const paidShares  = useMemo(() => equalSplit(amount, payerIds), [amount, payerIds]);

  const submit = async () => {
    if (!group) { setError('Choose a group.'); return; }
    if (!owedIds.length)  { setError('Choose who this should be split with.'); return; }
    if (!payerIds.length) { setError('Choose who paid.'); return; }
    setSubmitting(true); setError('');
    try {
      const members = group.members.filter(m => owedIds.includes(String(m.id)) || payerIds.includes(String(m.id)));
      const expense = await postExpense({
        description: description.trim() || transaction.description || 'Expense',
        groupId: group.id,
        paidAmounts:  paidShares,
        personTotals: owedShares,
        members,
      });
      onPosted(expense, group.id, owedShares[String(myId)] || 0);
    } catch (err) {
      setError(err?.message || 'Could not post to Splitwise. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-ink text-sm">Add to Splitwise</p>
            <p className="text-xs text-subtle mt-0.5 truncate">
              {formatCurrency(amount)} · {formatShortDate(transaction.date)} · {transaction.sourceName || transaction.source}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Enterprise Rent-A-Car"
              className="w-full bg-surface border border-edge rounded-xl px-3 py-2.5 text-sm text-ink outline-none focus:border-indigo-300 transition-colors"
            />
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-amber-600 bg-amber-50 rounded-xl p-2.5">No Splitwise groups found.</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Group</label>
                <div className="flex flex-wrap gap-2">
                  {groups.map(g => (
                    <button
                      key={g.id}
                      onClick={() => selectGroup(g.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${groupId === g.id ? 'text-white' : 'bg-surface text-muted border-edge hover:border-edge'}`}
                      style={groupId === g.id ? { background: INDIGO, borderColor: INDIGO } : {}}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>

              {group && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-muted">Split with</label>
                      <span className="text-xs text-subtle">
                        {owedIds.length > 0 ? `${formatCurrency(amount / owedIds.length)} each` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.members.map(m => {
                        const mid      = String(m.id);
                        const selected = owedIds.includes(mid);
                        const color    = memberColor(m.id, group.members);
                        return (
                          <button
                            key={m.id}
                            onClick={() => toggleOwed(m.id)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 font-semibold text-sm transition-all"
                            style={selected
                              ? { borderColor: color, background: color + '18', color }
                              : { borderColor: '#e2e8f0', background: '#fff', color: '#64748b' }}
                          >
                            {m.name}{selected && <Check size={13} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1.5">Who paid?</label>
                    <div className="flex flex-wrap gap-2">
                      {group.members.map(m => {
                        const mid      = String(m.id);
                        const selected = payerIds.includes(mid);
                        const color    = memberColor(m.id, group.members);
                        return (
                          <button
                            key={m.id}
                            onClick={() => togglePayer(m.id)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 font-semibold text-sm transition-all"
                            style={selected
                              ? { borderColor: color, background: color + '18', color }
                              : { borderColor: '#e2e8f0', background: '#fff', color: '#64748b' }}
                          >
                            {m.name}{selected && <Check size={13} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-edge space-y-2">
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
          <button
            onClick={submit}
            disabled={submitting || !group}
            className="w-full py-3 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 btn-gradient btn-press disabled:opacity-60"
          >
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Posting…</> : 'Post to Splitwise'}
          </button>
        </div>
      </div>
    </div>
  );
}

