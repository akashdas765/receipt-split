import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Store, Calendar, List, DollarSign, Trash2, Plus, ChevronDown, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { fetchGroups } from '../services/splitwise';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';
const CATS    = ['food', 'drink', 'alcohol', 'fee', 'tip', 'other'];
const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#10b981','#f97316','#06b6d4','#84cc16','#a855f7'];

function memberColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const FOOD_CATS = ['food', 'drink'];
function isTaxable(item, isGrocery) {
  if (item.tax_exempt) return false;
  if (isGrocery && FOOD_CATS.includes((item.category || '').toLowerCase())) return false;
  return true;
}

export default function DetailPage() {
  const navigate     = useNavigate();
  const { state: receipt } = useLocation();

  const [items,         setItems]         = useState(receipt?.items || []);
  const [merchant,      setMerchant]      = useState(receipt?.merchant || '');
  const [date,          setDate]          = useState(receipt?.date     || '');
  const [groups,        setGroups]        = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members,       setMembers]       = useState([]);
  const [isGrocery,     setIsGrocery]     = useState(false);
  const [taxRate,       setTaxRate]       = useState('7');
  const [loading,       setLoading]       = useState(true);
  const [swError,       setSwError]       = useState('');
  const [openCat,       setOpenCat]       = useState(null); // item id with open dropdown
  const [showBreakdown, setShowBreakdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!receipt) { navigate('/'); return; }
    fetchGroups()
      .then(grps => {
        setGroups(grps);
        if (grps.length > 0) { setSelectedGroup(grps[0].id); setMembers(grps[0].members); }
      })
      .catch(() => setSwError('Could not load Splitwise groups. Check your API key.'))
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpenCat(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const switchGroup = gid => {
    const grp = groups.find(g => g.id === gid);
    setSelectedGroup(gid); setMembers(grp?.members || []);
    setItems(prev => prev.map(i => ({ ...i, split_members: [] })));
  };

  const updateItem  = (id, field, value) => setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
  const deleteItem  = id => setItems(prev => prev.filter(i => i.id !== id));
  const addItem     = () => setItems(prev => [...prev, { id: String(Date.now()), description: 'New item', quantity: 1, amount: 0, category: 'other', tax_exempt: 0, split_members: [] }]);
  const toggleMember = (itemId, memberId) => setItems(prev => prev.map(item => {
    if (item.id !== itemId) return item;
    const ids = item.split_members || [], mid = String(memberId);
    return { ...item, split_members: ids.includes(mid) ? ids.filter(x => x !== mid) : [...ids, mid] };
  }));
  const splitAll = itemId => {
    const allIds = members.map(m => String(m.id));
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const cur = item.split_members || [];
      return { ...item, split_members: cur.length === allIds.length ? [] : allIds };
    }));
  };
  const toggleTaxExempt = id => setItems(prev => prev.map(i => i.id === id ? { ...i, tax_exempt: i.tax_exempt ? 0 : 1 } : i));

  const txRate = parseFloat(taxRate) / 100 || 0;
  const subtotalBeforeTax = () => items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const totalTaxAmount    = () => items.reduce((s, i) => s + (isTaxable(i, isGrocery) ? (parseFloat(i.amount) || 0) * txRate : 0), 0);
  const grandTotal        = () => items.reduce((s, i) => { const b = parseFloat(i.amount) || 0; return s + (isTaxable(i, isGrocery) ? b * (1 + txRate) : b); }, 0);
  const calcPersonTotals  = () => {
    const totals = {};
    items.forEach(item => {
      const ids = item.split_members || []; if (!ids.length) return;
      const b = parseFloat(item.amount) || 0;
      const total = isTaxable(item, isGrocery) ? b * (1 + txRate) : b;
      const share = total / ids.length;
      ids.forEach(id => { totals[id] = (totals[id] || 0) + share; });
    });
    return totals;
  };

  if (!receipt) return null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <span className="font-extrabold text-slate-800">Assign & Split</span>
        </div>
      </header>

      {/* Breakdown modal */}
      {showBreakdown && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
          onClick={() => setShowBreakdown(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-slate-800 text-base">Total Breakdown</h3>
              <button onClick={() => setShowBreakdown(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="flex justify-between py-3 border-b border-slate-100">
              <span className="text-sm text-slate-500">Subtotal (before tax)</span>
              <span className="font-bold text-slate-800">${subtotalBeforeTax().toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-3 border-b border-slate-100">
              <span className="text-sm text-slate-500">Tax ({taxRate}%)</span>
              <span className="font-bold text-amber-500">+${totalTaxAmount().toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-3">
              <span className="font-extrabold text-slate-800">Total after tax</span>
              <span className="font-extrabold text-xl" style={{ color: INDIGO }}>${grandTotal().toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Main scrollable */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-24 space-y-4">

          {swError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-600 font-medium">{swError}</p>
            </div>
          )}

          {/* Stats 2×2 */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Merchant', icon: Store, content: (
                <input value={merchant} onChange={e => setMerchant(e.target.value)}
                  placeholder="Enter merchant" className="w-full text-sm font-bold text-slate-800 bg-transparent outline-none border-b border-slate-200 pb-0.5 placeholder-slate-300" />
              )},
              { label: 'Date', icon: Calendar, content: (
                <input value={date} onChange={e => setDate(e.target.value)}
                  placeholder="YYYY-MM-DD" className="w-full text-sm font-bold text-slate-800 bg-transparent outline-none border-b border-slate-200 pb-0.5 placeholder-slate-300" />
              )},
              { label: 'Items', icon: List, content: (
                <p className="text-lg font-extrabold text-slate-800">{items.length}</p>
              )},
              { label: 'Total', icon: DollarSign, tappable: true, content: (
                <p className="text-lg font-extrabold" style={{ color: INDIGO }}>${grandTotal().toFixed(2)}</p>
              )},
            ].map(({ label, icon: Icon, content, tappable }) => {
              const Tag = tappable ? 'button' : 'div';
              return (
                <Tag key={label} onClick={tappable ? () => setShowBreakdown(true) : undefined}
                  className={`bg-white rounded-2xl p-3 border text-left ${tappable ? 'border-indigo-100 hover:bg-indigo-50/50 cursor-pointer transition-colors' : 'border-slate-100'} shadow-sm`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon size={13} style={{ color: INDIGO }} />
                    <span className="text-xs font-semibold text-slate-400">{label}{tappable ? ' ↗' : ''}</span>
                  </div>
                  {content}
                </Tag>
              );
            })}
          </div>

          {/* Group selector */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Splitwise Group</p>
            {loading ? (
              <div className="h-11 w-full bg-slate-100 rounded-xl animate-pulse" />
            ) : (
              <div className="relative">
                <select
                  value={selectedGroup ?? ''}
                  onChange={e => switchGroup(Number(e.target.value))}
                  className="w-full appearance-none bg-white border-2 rounded-xl px-4 py-2.5 pr-10 text-sm font-semibold text-slate-700 outline-none transition-colors cursor-pointer"
                  style={{ borderColor: INDIGO }}
                >
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: INDIGO }} />
              </div>
            )}
          </div>

          {/* Tax + Grocery */}
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
              <span className="text-slate-400 text-xs font-semibold">Tax %</span>
              <input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)}
                min="0" max="100" step="0.1"
                className="flex-1 text-sm font-bold text-slate-800 bg-transparent outline-none" />
            </div>
            <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer select-none">
              <span className="text-xs font-semibold text-slate-500">Grocery</span>
              <div
                onClick={() => setIsGrocery(v => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${isGrocery ? '' : 'bg-slate-200'}`}
                style={isGrocery ? { background: EMERALD } : {}}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isGrocery ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
            </label>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Items</p>
              <button onClick={addItem}
                className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors hover:bg-indigo-50"
                style={{ color: INDIGO }}>
                <Plus size={14} /> Add item
              </button>
            </div>

            <div ref={dropdownRef} className="space-y-3">
              {items.map(item => {
                const taxable   = isTaxable(item, isGrocery);
                const base      = parseFloat(item.amount) || 0;
                const lineTotal = taxable ? base * (1 + txRate) : base;
                const assigned  = item.split_members || [];
                const catOpen   = openCat === item.id;

                return (
                  <div key={item.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    {/* Name + delete */}
                    <div className="flex items-center gap-2 mb-3">
                      <input value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)}
                        placeholder="Item name"
                        className="flex-1 font-bold text-sm text-slate-800 bg-transparent outline-none border-b border-slate-200 pb-0.5 placeholder-slate-300" />
                      <button onClick={() => deleteItem(item.id)} className="p-1 text-red-300 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Qty × Price = Total + Tax badge */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                        <span className="text-xs text-slate-400 font-semibold">Qty</span>
                        <input type="number" value={item.quantity} min="1"
                          onChange={e => updateItem(item.id, 'quantity', parseInt(e.target.value) || 1)}
                          className="w-10 text-sm font-bold text-slate-800 bg-transparent outline-none text-center" />
                      </div>
                      <span className="text-slate-300 font-bold text-sm">×</span>
                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                        <span className="text-xs text-slate-400 font-semibold">$</span>
                        <input type="number" value={item.amount} min="0" step="0.01"
                          onChange={e => updateItem(item.id, 'amount', e.target.value)}
                          className="w-16 text-sm font-bold text-slate-800 bg-transparent outline-none text-center" />
                      </div>
                      <span className="text-slate-300 font-bold text-sm">=</span>
                      <span className="font-extrabold text-sm text-slate-800">${lineTotal.toFixed(2)}</span>
                      <button onClick={() => toggleTaxExempt(item.id)}
                        className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-lg ${item.tax_exempt ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                        {item.tax_exempt ? 'Tax-free' : 'Taxed'}
                      </button>
                    </div>

                    {/* Category dropdown */}
                    <div className="relative inline-block mb-3">
                      <button
                        onClick={e => { e.stopPropagation(); setOpenCat(catOpen ? null : item.id); }}
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 border border-slate-200 bg-slate-50 rounded-lg px-2.5 py-1 hover:border-indigo-200 transition-colors"
                      >
                        {(item.category || 'other').charAt(0).toUpperCase() + (item.category || 'other').slice(1)}
                        <ChevronDown size={12} />
                      </button>
                      {catOpen && (
                        <div className="absolute top-full mt-1 left-0 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[130px]">
                          {CATS.map(cat => (
                            <button key={cat} onClick={() => { updateItem(item.id, 'category', cat); setOpenCat(null); }}
                              className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between
                                ${item.category === cat ? 'font-bold bg-indigo-50' : 'text-slate-600 hover:bg-slate-50'}`}
                              style={item.category === cat ? { color: INDIGO } : {}}>
                              {cat.charAt(0).toUpperCase() + cat.slice(1)}
                              {item.category === cat && <CheckCircle2 size={14} style={{ color: INDIGO }} />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Member pills */}
                    <div className="flex flex-wrap gap-1.5">
                      {members.map(m => {
                        const active = assigned.includes(String(m.id));
                        const color  = memberColor(m.name);
                        return (
                          <button key={m.id} onClick={() => toggleMember(item.id, m.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border-2 transition-all"
                            style={active
                              ? { background: color, borderColor: color, color: '#fff' }
                              : { background: '#f8faff', borderColor: '#e2e8f0', color: '#64748b' }}>
                            {active && (
                              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold"
                                style={{ background: color + '40', color }}>
                                {m.name?.[0]?.toUpperCase()}
                              </span>
                            )}
                            {m.name}
                          </button>
                        );
                      })}
                      <button onClick={() => splitAll(item.id)}
                        className="px-2.5 py-1 rounded-full text-xs font-bold border-2 transition-all"
                        style={{ borderColor: '#e0e7ff', background: '#e0e7ff', color: INDIGO }}>
                        {assigned.length === members.length && members.length > 0 ? 'Clear' : 'All'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-10 bg-white border-t border-slate-100 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <button
            onClick={() => navigate('/approve', { state: {
              receiptId:    receipt.id,
              groupId:      selectedGroup,
              members,
              personTotals: calcPersonTotals(),
              grandTotal:   grandTotal(),
              merchant:     merchant || receipt.merchant,
            }})}
            className="w-full py-3.5 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
            style={{ background: EMERALD, boxShadow: '0 4px 16px rgba(16,185,129,0.4)' }}
          >
            <CheckCircle2 size={20} /> Review & Approve
          </button>
        </div>
      </div>
    </div>
  );
}
