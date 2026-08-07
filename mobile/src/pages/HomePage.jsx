import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, LogOut, Plus, Trash2, CheckCheck, AlertTriangle, X, TrendingUp } from 'lucide-react';
import { logout } from '../services/auth';
import { loadReceipts, deleteReceipt } from '../services/db';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';

export default function HomePage() {
  const navigate = useNavigate();
  const [receipts,   setReceipts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cursor,     setCursor]     = useState(null);
  const [hasMore,    setHasMore]    = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // { id, merchant } | null
  const [deleting,    setDeleting]    = useState(false);

  const load = useCallback(async () => {
    const { receipts: list, cursor: next, hasMore: more } = await loadReceipts();
    setReceipts(list);
    setCursor(next);
    setHasMore(more);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const { receipts: list, cursor: next, hasMore: more } = await loadReceipts(cursor);
    setReceipts(r => [...r, ...list]);
    setCursor(next);
    setHasMore(more);
    setLoadingMore(false);
  };

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    setDeleting(true);
    await deleteReceipt(confirmTarget.id);
    setReceipts(r => r.filter(x => x.id !== confirmTarget.id));
    setDeleting(false);
    setConfirmTarget(null);
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      {/* Delete confirmation modal */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4 anim-fade-in"
          onClick={() => !deleting && setConfirmTarget(null)}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl anim-sheet-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <AlertTriangle size={18} className="text-red-500" />
                </div>
                <h3 className="font-extrabold text-slate-800 text-base">Remove receipt?</h3>
              </div>
              <button onClick={() => setConfirmTarget(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-500 mb-5">
              This will permanently remove <span className="font-semibold text-slate-700">{confirmTarget.merchant || 'this receipt'}</span> from your history.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmTarget(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors btn-press disabled:opacity-60">
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-red-500 hover:bg-red-600 transition-colors btn-press disabled:opacity-60">
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 glass">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center logo-glow">
              <Receipt size={15} color="#fff" />
            </div>
            <span className="font-extrabold text-gradient text-base tracking-tight">ReceiptSplit</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/insights')}
              className="p-2 rounded-lg text-indigo-400 hover:bg-indigo-50 transition-colors"
              title="Insights"
            >
              <TrendingUp size={18} />
            </button>
            <button
              onClick={() => navigate('/scan')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-white text-sm font-bold btn-gradient btn-press"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Scan Receipt</span>
              <span className="sm:hidden">Scan</span>
            </button>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4">
        {loading ? (
          <div className="flex flex-col gap-3 pt-8">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-2xl p-4 bg-white border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl skeleton shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/2 rounded-full skeleton" />
                    <div className="h-3 w-3/4 rounded-full skeleton" />
                  </div>
                  <div className="h-4 w-14 rounded-full skeleton shrink-0" />
                </div>
              </div>
            ))}
          </div>
        ) : receipts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center anim-scale-in">
            <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center mb-4 anim-float">
              <Receipt size={36} style={{ color: '#a5b4fc' }} />
            </div>
            <h2 className="text-lg font-bold text-slate-500 mb-1">No receipts yet</h2>
            <p className="text-sm text-slate-400">Tap Scan Receipt to get started</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-400 font-medium">{receipts.length} receipt{receipts.length !== 1 ? 's' : ''}</p>
              <button
                onClick={() => { setRefreshing(true); load(); }}
                className="text-xs font-semibold transition-colors"
                style={{ color: INDIGO }}
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            <div className="flex flex-col gap-3 stagger">
              {receipts.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate('/detail', { state: r })}
                  className="w-full text-left bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:border-indigo-100 card-lift anim-fade-up"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md"
                      style={{ background: r.approved
                        ? 'linear-gradient(135deg, #10b981, #14b8a6)'
                        : 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
                      {r.approved
                        ? <CheckCheck size={18} color="#fff" />
                        : <Receipt size={18} color="#fff" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 text-sm truncate">
                        {r.merchant || 'Unknown merchant'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-400">
                          {r.date || r.scanned_at?.slice(0, 10)}
                        </span>
                        <span className="text-slate-200">·</span>
                        <span className="text-xs font-semibold" style={{ color: r.approved ? EMERALD : '#f59e0b' }}>
                          {r.approved ? 'Posted' : 'Pending'}
                        </span>
                        <span className="text-slate-200">·</span>
                        <span className="text-xs text-slate-400">{r.items?.length || 0} items</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-bold text-slate-800 text-sm">${(r.grandTotal ?? r.total ?? 0).toFixed(2)}</span>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmTarget({ id: r.id, merchant: r.merchant }); }}
                        className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold text-slate-500 bg-white border border-slate-100 hover:border-indigo-100 hover:text-indigo-500 transition-colors disabled:opacity-60"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
