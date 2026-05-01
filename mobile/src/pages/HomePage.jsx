import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, LogOut, Plus, Trash2, CheckCheck, Clock } from 'lucide-react';
import { logout } from '../services/auth';
import { loadReceipts, deleteReceipt } from '../services/db';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';

export default function HomePage() {
  const navigate = useNavigate();
  const [receipts,   setReceipts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await loadReceipts();
    setReceipts(list);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (id, merchant) => {
    if (!window.confirm(`Remove "${merchant || 'this receipt'}"?`)) return;
    deleteReceipt(id).then(() => setReceipts(r => r.filter(x => x.id !== id)));
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt size={20} style={{ color: INDIGO }} />
            <span className="font-extrabold text-slate-800 text-base">ReceiptSplit</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/scan')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: INDIGO }}
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
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo animate-spin" />
          </div>
        ) : receipts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
              <Receipt size={36} style={{ color: '#c7d2fe' }} />
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

            <div className="flex flex-col gap-3">
              {receipts.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate('/detail', { state: r })}
                  className="w-full text-left bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: r.approved ? EMERALD : INDIGO }}>
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
                      <span className="font-bold text-slate-800 text-sm">${(r.total || 0).toFixed(2)}</span>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(r.id, r.merchant); }}
                        className="p-1.5 rounded-lg text-red-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
