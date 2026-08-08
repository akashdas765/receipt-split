import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Store, Calendar, List, DollarSign, Trash2, Plus, ChevronDown, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { fetchGroups } from '../services/splitwise';
import { memberColor } from '../utils/memberColor';
import PageHeader from '../components/PageHeader';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';
const CATS    = ['food', 'drink', 'alcohol', 'fee', 'tip', 'other'];

const FOOD_CATS = ['food', 'drink'];
function isTaxable(item, isGrocery) {
  if (item.tax_exempt) return false;
  if (isGrocery && FOOD_CATS.includes((item.category || '').toLowerCase())) return false;
  return true;
}

// Normalize items coming from Firestore (old format used split_members string[])
// and from OCR (which only has quantity + line-total amount, no unit price).
function normalizeItems(rawItems) {
  return (rawItems || []).map(item => {
    const qty = parseFloat(item.quantity) || 1;
    return {
      ...item,
      split_shares: item.split_shares ||
        Object.fromEntries((item.split_members || []).map(id => [id, 1])),
      unit_price: item.unit_price ?? (parseFloat(item.amount) || 0) / qty,
      split_mode: item.split_mode || 'whole',
      unit_shares: item.unit_shares || Array.from({ length: Math.max(1, Math.round(qty)) }, () => ({})),
    };
  });
}

// Source of truth for an item's pre-tax total: unit price × quantity, both
// kept as the raw strings the user is typing so editing one field never
// clobbers mid-edit text in the other (see updateItem — no parsing on keystroke).
function lineAmount(item) {
  return (parseFloat(item.unit_price) || 0) * (parseFloat(item.quantity) || 1);
}

export default function DetailPage() {
  const navigate     = useNavigate();
  const { state: receipt } = useLocation();

  const [items,         setItems]         = useState(normalizeItems(receipt?.items));
  const [merchant,      setMerchant]      = useState(receipt?.merchant || '');
  const [date,          setDate]          = useState(receipt?.date     || new Date().toISOString().split('T')[0]);
  const [groups,        setGroups]        = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members,       setMembers]       = useState([]);
  const [isGrocery,     setIsGrocery]     = useState(false);
  const [taxRate,       setTaxRate]       = useState('7');
  const [loading,       setLoading]       = useState(true);
  const [swError,       setSwError]       = useState('');
  const [showFallbackNotice, setShowFallbackNotice] = useState(!!receipt?.usedFallback);
  const [openCat,       setOpenCat]       = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const dropdownRef  = useRef(null);
  const newItemIdRef = useRef(null);

  useEffect(() => {
    if (!receipt) { navigate('/'); return; }
    fetchGroups()
      .then(grps => {
        setGroups(grps);
        if (grps.length > 0) { setSelectedGroup(grps[0].id); setMembers(grps[0].members); }
      })
      .catch(err => setSwError(err?.message || 'Could not load Splitwise groups. Check your API key.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!newItemIdRef.current) return;
    const el = document.getElementById(`item-${newItemIdRef.current}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); newItemIdRef.current = null; }
  }, [items]);

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
    setItems(prev => prev.map(i => ({ ...i, split_shares: {}, split_members: [] })));
  };

  const updateItem  = (id, field, value) => setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
  const deleteItem  = id => setItems(prev => prev.filter(i => i.id !== id));
  const addItem     = () => {
    const id = String(Date.now());
    newItemIdRef.current = id;
    setItems(prev => [...prev, { id, description: 'New item', quantity: 1, unit_price: 0, amount: 0, category: 'other', tax_exempt: 0, split_shares: {}, split_members: [] }]);
  };

  const toggleMember = (itemId, memberId) => setItems(prev => prev.map(item => {
    if (item.id !== itemId) return item;
    const mid    = String(memberId);
    const shares = { ...(item.split_shares || {}) };
    if (shares[mid]) {
      delete shares[mid];
    } else {
      shares[mid] = 1;
    }
    return { ...item, split_shares: shares, split_members: Object.keys(shares) };
  }));

  const adjustShare = (itemId, memberId, delta) => setItems(prev => prev.map(item => {
    if (item.id !== itemId) return item;
    const mid    = String(memberId);
    const shares = { ...(item.split_shares || {}) };
    shares[mid]  = Math.max(1, (shares[mid] || 1) + delta);
    return { ...item, split_shares: shares };
  }));

  const splitAll = itemId => {
    const allIds = members.map(m => String(m.id));
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const cur = Object.keys(item.split_shares || {});
      if (cur.length === allIds.length) {
        return { ...item, split_shares: {}, split_members: [] };
      }
      const shares = { ...(item.split_shares || {}) };
      allIds.forEach(id => { if (!shares[id]) shares[id] = 1; });
      return { ...item, split_shares: shares, split_members: allIds };
    }));
  };

  const toggleTaxExempt = id => setItems(prev => prev.map(i => i.id === id ? { ...i, tax_exempt: i.tax_exempt ? 0 : 1 } : i));

  // Per-unit splitting: for items with quantity > 1, each unit can be assigned
  // to a different subset of members (e.g. 1 of 3 milks to one person, the
  // other 2 split three ways) instead of the whole line sharing one split.
  const toggleSplitMode = itemId => setItems(prev => prev.map(item => {
    if (item.id !== itemId) return item;
    const qty = Math.max(1, Math.round(parseFloat(item.quantity) || 1));
    return {
      ...item,
      split_mode: item.split_mode === 'unit' ? 'whole' : 'unit',
      unit_shares: item.unit_shares?.length === qty ? item.unit_shares : Array.from({ length: qty }, () => ({})),
    };
  }));

  const toggleUnitMember = (itemId, unitIdx, memberId) => setItems(prev => prev.map(item => {
    if (item.id !== itemId) return item;
    const mid = String(memberId);
    const unitShares = item.unit_shares.map((u, i) => i === unitIdx ? { ...u } : u);
    const u = unitShares[unitIdx];
    if (u[mid]) delete u[mid]; else u[mid] = 1;
    return { ...item, unit_shares: unitShares };
  }));

  const adjustUnitShare = (itemId, unitIdx, memberId, delta) => setItems(prev => prev.map(item => {
    if (item.id !== itemId) return item;
    const mid = String(memberId);
    const unitShares = item.unit_shares.map((u, i) => i === unitIdx ? { ...u } : u);
    const u = unitShares[unitIdx];
    u[mid] = Math.max(1, (u[mid] || 1) + delta);
    return { ...item, unit_shares: unitShares };
  }));

  const txRate = parseFloat(taxRate) / 100 || 0;
  const subtotalBeforeTax = () => items.reduce((s, i) => s + lineAmount(i), 0);
  const totalTaxAmount    = () => items.reduce((s, i) => s + (isTaxable(i, isGrocery) ? lineAmount(i) * txRate : 0), 0);
  const grandTotal        = () => items.reduce((s, i) => { const b = lineAmount(i); return s + (isTaxable(i, isGrocery) ? b * (1 + txRate) : b); }, 0);

  const calcPersonTotals = () => {
    const totals = {};
    const taxMult = item => isTaxable(item, isGrocery) ? (1 + txRate) : 1;

    items.forEach(item => {
      if (item.split_mode === 'unit' && item.unit_shares?.length) {
        const unitTotal = (parseFloat(item.unit_price) || 0) * taxMult(item);
        item.unit_shares.forEach(u => {
          const memberIds = Object.keys(u).filter(id => (u[id] || 0) > 0);
          if (!memberIds.length) return;
          const totalShares = memberIds.reduce((s, id) => s + (u[id] || 0), 0);
          memberIds.forEach(id => {
            totals[id] = (totals[id] || 0) + (unitTotal * u[id] / totalShares);
          });
        });
        return;
      }
      const shares    = item.split_shares || {};
      const memberIds = Object.keys(shares).filter(id => (shares[id] || 0) > 0);
      if (!memberIds.length) return;
      const totalShares = memberIds.reduce((s, id) => s + (shares[id] || 0), 0);
      const lineTotal   = lineAmount(item) * taxMult(item);
      memberIds.forEach(id => {
        totals[id] = (totals[id] || 0) + (lineTotal * shares[id] / totalShares);
      });
    });
    return totals;
  };

  if (!receipt) return null;

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      {/* Header */}
      <PageHeader title="Assign & Split" onBack={() => navigate('/')} />

      {/* Breakdown modal */}
      {showBreakdown && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 anim-fade-in"
          onClick={() => setShowBreakdown(false)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl anim-sheet-up" onClick={e => e.stopPropagation()}>
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
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 anim-pop">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-600 font-medium">{swError}</p>
            </div>
          )}

          {showFallbackNotice && (
            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 anim-pop">
              <AlertCircle size={15} className="text-indigo-500 shrink-0" />
              <p className="text-sm text-indigo-600 font-medium flex-1">Our main AI was at capacity, so this receipt was parsed with a backup model — double-check the items below.</p>
              <button onClick={() => setShowFallbackNotice(false)} className="text-indigo-400 hover:text-indigo-600 shrink-0"><X size={15} /></button>
            </div>
          )}

          {/* Stats 2×2 */}
          <div className="grid grid-cols-2 gap-3 stagger">
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
                  className={`bg-white rounded-2xl p-3 border text-left anim-fade-up ${tappable ? 'border-indigo-100 hover:bg-indigo-50/50 cursor-pointer card-lift' : 'border-slate-100'} shadow-sm`}>
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
              <div className="h-11 w-full rounded-xl skeleton" />
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

            <div ref={dropdownRef} className="space-y-3 stagger">
              {items.map(item => {
                const taxable    = isTaxable(item, isGrocery);
                const base       = lineAmount(item);
                const lineTotal  = taxable ? base * (1 + txRate) : base;
                const shares     = item.split_shares || {};
                const assignedIds = Object.keys(shares).filter(id => shares[id] > 0);
                const catOpen    = openCat === item.id;

                return (
                  <div key={item.id} id={`item-${item.id}`} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm anim-fade-up">
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
                        <input type="number" value={item.quantity} min="0"
                          onChange={e => updateItem(item.id, 'quantity', e.target.value === '' ? '0' : e.target.value)}
                          onBlur={() => { if (!parseFloat(item.quantity)) updateItem(item.id, 'quantity', 1); }}
                          className="w-10 text-sm font-bold text-slate-800 bg-transparent outline-none text-center" />
                      </div>
                      <span className="text-slate-300 font-bold text-sm">×</span>
                      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                        <span className="text-xs text-slate-400 font-semibold">$</span>
                        <input type="number" value={item.unit_price} min="0" step="0.01"
                          onChange={e => updateItem(item.id, 'unit_price', e.target.value)}
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
                        <div className="absolute top-full mt-1 left-0 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[130px] anim-scale-in origin-top-left">
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

                    {/* Split mode toggle (only meaningful for qty > 1) */}
                    {Math.round(parseFloat(item.quantity) || 1) > 1 && (
                      <button onClick={() => toggleSplitMode(item.id)}
                        className="mb-2 text-xs font-bold px-2.5 py-1 rounded-lg transition-colors hover:bg-indigo-100"
                        style={{ background: '#eef1fb', color: INDIGO }}>
                        {item.split_mode === 'unit' ? 'Whole item' : 'Split per unit'}
                      </button>
                    )}

                    {item.split_mode === 'unit' ? (
                      /* Per-unit member pills — each of the `quantity` units gets its own split */
                      <div className="flex flex-col gap-2.5 pl-3 border-l-2 border-slate-100">
                        {item.unit_shares.map((u, unitIdx) => {
                          const unitAssignedIds = Object.keys(u).filter(id => u[id] > 0);
                          return (
                            <div key={unitIdx}>
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">Unit {unitIdx + 1}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {members.map(m => {
                                  const mid         = String(m.id);
                                  const shareCount  = u[mid] || 0;
                                  const active      = shareCount > 0;
                                  const color       = memberColor(m.id, members);
                                  const totalShares = unitAssignedIds.reduce((s, id) => s + (u[id] || 0), 0);
                                  return (
                                    <div key={m.id}
                                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border-2 transition-all select-none ${active ? 'anim-pop shadow-md' : 'hover:border-indigo-200'}`}
                                      style={active
                                        ? { background: color, borderColor: color, color: '#fff', boxShadow: `0 4px 12px ${color}55` }
                                        : { background: '#f8faff', borderColor: '#e2e8f0', color: '#64748b' }}>
                                      {active ? (
                                        <>
                                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0" style={{ background: 'rgba(255,255,255,0.25)' }}>
                                            {m.name?.[0]?.toUpperCase()}
                                          </span>
                                          <button onClick={() => toggleUnitMember(item.id, unitIdx, m.id)} className="font-semibold leading-none">{m.name}</button>
                                          <button onClick={e => { e.stopPropagation(); adjustUnitShare(item.id, unitIdx, m.id, -1); }}
                                            className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 leading-none"
                                            style={{ background: 'rgba(255,255,255,0.25)' }}>−</button>
                                          <span className="font-extrabold min-w-[10px] text-center leading-none">{shareCount}</span>
                                          <button onClick={e => { e.stopPropagation(); adjustUnitShare(item.id, unitIdx, m.id, 1); }}
                                            className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 leading-none"
                                            style={{ background: 'rgba(255,255,255,0.25)' }}>+</button>
                                          {totalShares > 0 && (
                                            <span className="text-[10px] opacity-70 leading-none">{Math.round(shareCount / totalShares * 100)}%</span>
                                          )}
                                        </>
                                      ) : (
                                        <button onClick={() => toggleUnitMember(item.id, unitIdx, m.id)} className="leading-none">{m.name}</button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                    /* Member pills */
                    <div className="flex flex-wrap gap-1.5">
                      {members.map(m => {
                        const mid        = String(m.id);
                        const shareCount = shares[mid] || 0;
                        const active     = shareCount > 0;
                        const color      = memberColor(m.id, members);
                        const totalShares = assignedIds.reduce((s, id) => s + (shares[id] || 0), 0);

                        return (
                          <div key={m.id}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border-2 transition-all select-none ${active ? 'anim-pop shadow-md' : 'hover:border-indigo-200'}`}
                            style={active
                              ? { background: color, borderColor: color, color: '#fff', boxShadow: `0 4px 12px ${color}55` }
                              : { background: '#f8faff', borderColor: '#e2e8f0', color: '#64748b' }}>
                            {active ? (
                              <>
                                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0"
                                  style={{ background: 'rgba(255,255,255,0.25)' }}>
                                  {m.name?.[0]?.toUpperCase()}
                                </span>
                                <button
                                  onClick={() => toggleMember(item.id, m.id)}
                                  className="font-semibold leading-none"
                                >
                                  {m.name}
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); adjustShare(item.id, m.id, -1); }}
                                  className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 leading-none"
                                  style={{ background: 'rgba(255,255,255,0.25)' }}
                                >−</button>
                                <span className="font-extrabold min-w-[10px] text-center leading-none">
                                  {shareCount}
                                </span>
                                <button
                                  onClick={e => { e.stopPropagation(); adjustShare(item.id, m.id, 1); }}
                                  className="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 leading-none"
                                  style={{ background: 'rgba(255,255,255,0.25)' }}
                                >+</button>
                                {totalShares > 0 && (
                                  <span className="text-[10px] opacity-70 leading-none">
                                    {Math.round(shareCount / totalShares * 100)}%
                                  </span>
                                )}
                              </>
                            ) : (
                              <button onClick={() => toggleMember(item.id, m.id)} className="leading-none">
                                {m.name}
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button onClick={() => splitAll(item.id)}
                        className="px-2.5 py-1 rounded-full text-xs font-bold border-2 transition-all btn-press"
                        style={{ borderColor: '#e0e7ff', background: '#e0e7ff', color: INDIGO }}>
                        {assignedIds.length === members.length && members.length > 0 ? 'Clear' : 'All'}
                      </button>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-10 glass-footer">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <button
            onClick={() => navigate('/approve', { state: {
              receiptId:    receipt.id,
              groupId:      selectedGroup,
              members,
              items:        items.map(i => ({ ...i, amount: lineAmount(i) })),
              personTotals: calcPersonTotals(),
              grandTotal:   grandTotal(),
              merchant:     merchant || receipt.merchant,
              // Present if this receipt was already posted — re-posting
              // then updates that expense instead of creating a duplicate.
              existingExpenseId: receipt.splitwise_expense_id || null,
            }})}
            className="w-full py-3.5 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2 btn-gradient-emerald btn-press"
          >
            <CheckCircle2 size={20} /> Review & Approve
          </button>
        </div>
      </div>
    </div>
  );
}
