import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { loadReceiptsForInsights } from '../services/db';
import { fetchCurrentUser } from '../services/splitwise';
import { computeStats, fetchInsights } from '../services/insights';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';

export default function InsightsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [stats,   setStats]   = useState(null);

  const [aiText,    setAiText]    = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError,   setAiError]   = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [receipts, me] = await Promise.all([
          loadReceiptsForInsights(),
          fetchCurrentUser().catch(() => null),
        ]);
        setStats(computeStats(receipts, me?.id));
      } catch (err) {
        setError(err?.message || 'Could not load your expense history.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const generateInsights = async () => {
    if (!stats) return;
    setAiLoading(true); setAiError(''); setAiText('');
    try {
      setAiText(await fetchInsights(stats));
    } catch (err) {
      setAiError(err?.message || 'Could not generate insights.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      <header className="sticky top-0 z-20 glass">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-600 btn-press">
            <ArrowLeft size={20} />
          </button>
          <span className="font-extrabold text-slate-800">Insights</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-10 space-y-5">
          {loading ? (
            <div className="flex flex-col gap-3 pt-8">
              {[0, 1].map(i => <div key={i} className="h-24 rounded-2xl skeleton" />)}
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 anim-pop">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-600 font-medium">{error}</p>
            </div>
          ) : stats.receiptCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center anim-scale-in">
              <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center mb-4 anim-float">
                <TrendingUp size={36} style={{ color: '#a5b4fc' }} />
              </div>
              <h2 className="text-lg font-bold text-slate-500 mb-1">Nothing to analyze yet</h2>
              <p className="text-sm text-slate-400">Scan a few receipts and check back</p>
            </div>
          ) : (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-3 stagger">
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm anim-fade-up">
                  <p className="text-xs font-semibold text-slate-400 mb-1">Total spend</p>
                  <p className="text-xl font-extrabold text-slate-800">${stats.totalSpent.toFixed(2)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{stats.receiptCount} receipt{stats.receiptCount !== 1 ? 's' : ''}</p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm anim-fade-up">
                  <p className="text-xs font-semibold text-slate-400 mb-1">Your share</p>
                  {stats.hasMyShare ? (
                    <>
                      <p className="text-xl font-extrabold" style={{ color: INDIGO }}>${stats.myShare.toFixed(2)}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">across {stats.myShareCount} posted receipt{stats.myShareCount !== 1 ? 's' : ''}</p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400 mt-1">Couldn't match your Splitwise profile</p>
                  )}
                </div>
              </div>

              {/* Top merchants */}
              {stats.topMerchants.length > 0 && (
                <div className="anim-fade-up">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Top merchants</p>
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    {stats.topMerchants.map((m, i) => {
                      const pct = stats.topMerchants[0].amount ? (m.amount / stats.topMerchants[0].amount) * 100 : 0;
                      return (
                        <div key={m.merchant} className={`px-4 py-3 ${i < stats.topMerchants.length - 1 ? 'border-b border-slate-100' : ''}`}>
                          <div className="flex items-center justify-between mb-1.5 gap-2">
                            <span className="text-sm font-semibold text-slate-700 truncate">{m.merchant}</span>
                            <span className="text-sm font-bold text-slate-800 shrink-0">${m.amount.toFixed(2)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: INDIGO }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly */}
              {stats.monthly.length > 0 && (
                <div className="anim-fade-up">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">By month</p>
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-end gap-3 h-32">
                    {stats.monthly.map(m => {
                      const max = Math.max(...stats.monthly.map(x => x.amount), 1);
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                          <div className="w-full rounded-t-lg" style={{ height: `${Math.max((m.amount / max) * 100, 3)}%`, background: EMERALD }} />
                          <span className="text-[10px] text-slate-400 font-semibold">{m.month.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* AI insights */}
              <div className="anim-fade-up">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">AI insights</p>
                  {!aiLoading && (
                    <button
                      onClick={generateInsights}
                      className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg transition-colors hover:bg-indigo-50"
                      style={{ color: INDIGO }}
                    >
                      <Sparkles size={12} /> {aiText ? 'Regenerate' : 'Generate'}
                    </button>
                  )}
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 min-h-[76px] flex items-center">
                  {aiLoading ? (
                    <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin" /> Thinking…</div>
                  ) : aiError ? (
                    <p className="text-sm text-red-500">{aiError}</p>
                  ) : aiText ? (
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{aiText}</p>
                  ) : (
                    <p className="text-sm text-slate-400">Tap Generate for a quick AI summary of your spending.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
