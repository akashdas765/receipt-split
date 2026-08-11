import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, Loader2, AlertCircle, Send } from 'lucide-react';
import { loadReceiptsForInsights, loadTransactions } from '../services/db';
import { fetchCurrentUser, fetchAllExpenses } from '../services/splitwise';
import { computeStats, askInsightsChat } from '../services/insights';
import { getMonthRange } from '../utils/statementFormatters';
import { getCategoryIcon } from '../utils/categoryDetector';
import BottomNav from '../components/BottomNav';
import MonthSlider from '../components/MonthSlider';
import PageHeader from '../components/PageHeader';
import CategoryDetail from '../components/CategoryDetail';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';

const SUGGESTIONS = [
  'Where am I spending the most?',
  'How does my share compare to the group total?',
  'Any trends month to month?',
];

export default function InsightsPage() {
  // Full receipt/transaction history, loaded once — filtered to the
  // selected month client-side, same pattern HomePage uses.
  const [receipts,     setReceipts]     = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [myId,         setMyId]         = useState(null);
  // Own full name — used to recognize a Zelle-style self-transfer whose
  // description names the person ("from Akash Das") rather than the
  // account, same as StatementsPage's transfer detection.
  const [myFullName,   setMyFullName]   = useState('');
  const [initialLoading, setInitialLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  const [selectedCategory, setSelectedCategory] = useState(null); // category name being drilled into | null

  const [messages,   setMessages]   = useState([]); // [{ role, content }]
  const [input,      setInput]      = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError,   setChatError]   = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [receiptsList, txns, me] = await Promise.all([
          loadReceiptsForInsights(),
          loadTransactions(),
          fetchCurrentUser().catch(() => null),
        ]);
        setReceipts(receiptsList);
        setTransactions(txns);
        setMyId(me?.id || null);
        setMyFullName(me ? [me.name, me.lastName].filter(Boolean).join(' ') : '');
      } catch (err) {
        setError(err?.message || 'Could not load your expense history.');
      } finally {
        setInitialLoading(false);
      }
    })();
  }, []);

  // Re-scopes Splitwise history to the selected month and recomputes stats
  // — mirrors HomePage/Statements' per-month fetch pattern.
  useEffect(() => {
    if (initialLoading) return;
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      try {
        const { start, end } = getMonthRange(currentMonth);
        let splitwiseExpenses = [];
        if (myId) {
          const sw = await fetchAllExpenses(myId, { datedAfter: start, datedBefore: end }).catch(() => ({ expenses: [] }));
          splitwiseExpenses = sw.expenses;
        }
        const monthlyReceipts = receipts.filter(r => {
          const d = (r.date || r.scanned_at || '').slice(0, 10);
          return d >= start && d <= end;
        });
        const monthlyTxns = transactions.filter(t => t.date && t.date.slice(0, 10) >= start && t.date.slice(0, 10) <= end);
        if (!cancelled) {
          setStats(computeStats({ receipts: monthlyReceipts, myId, myFullName, transactions: monthlyTxns, splitwiseExpenses }));
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load your expense history.');
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initialLoading, currentMonth, myId, myFullName, receipts, transactions]);

  // The chat's context is tied to whichever month's stats it was sent —
  // switching months mid-conversation would otherwise leave earlier answers
  // referencing a different period than newer ones, so start fresh instead.
  useEffect(() => {
    setMessages([]);
    setSelectedCategory(null);
  }, [currentMonth]);

  const loading = initialLoading || statsLoading;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, chatLoading]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || chatLoading || !stats) return;
    const next = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setChatLoading(true);
    setChatError('');
    try {
      const reply = await askInsightsChat(stats, next);
      setMessages(m => [...m, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatError(err?.message || 'Could not get a response.');
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      <PageHeader title="Insights" showBack={false} />

      <MonthSlider currentMonth={currentMonth} onChange={setCurrentMonth} />

      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 py-4 pb-24 space-y-5">
          {loading ? (
            <div className="flex flex-col gap-3 pt-8">
              {[0, 1].map(i => <div key={i} className="h-24 rounded-2xl skeleton" />)}
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 anim-pop">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-600 font-medium">{error}</p>
            </div>
          ) : stats.totalSpent === 0 && stats.topMerchants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center anim-scale-in">
              <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center mb-4 anim-float">
                <TrendingUp size={36} style={{ color: '#a5b4fc' }} />
              </div>
              <h2 className="text-lg font-bold text-muted mb-1">Nothing to analyze yet</h2>
              <p className="text-sm text-subtle">Scan a receipt, connect Splitwise, or import a bank statement</p>
            </div>
          ) : (
            <>
              {/* Data sources — makes clear this isn't just scanned receipts */}
              <p className="text-xs text-subtle anim-fade-up">
                {stats.receiptCount} receipt{stats.receiptCount !== 1 ? 's' : ''}
                {' · '}{stats.mySplitwiseShareCount} Splitwise expense{stats.mySplitwiseShareCount !== 1 ? 's' : ''}
                {stats.hasBankData && <> · {stats.transactionCount} bank transaction{stats.transactionCount !== 1 ? 's' : ''}</>}
              </p>

              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-3 stagger">
                <div className="bg-surface rounded-2xl p-4 border border-edge shadow-sm anim-fade-up">
                  <p className="text-xs font-semibold text-subtle mb-1">Total spend</p>
                  <p className="text-xl font-extrabold text-ink">${stats.totalSpent.toFixed(2)}</p>
                  <p className="text-[11px] text-subtle mt-0.5">
                    {stats.hasBankData ? 'reconciled with bank data' : 'Splitwise + pending receipts'}
                  </p>
                </div>
                <div className="bg-surface rounded-2xl p-4 border border-edge shadow-sm anim-fade-up">
                  <p className="text-xs font-semibold text-subtle mb-1">Your Splitwise share</p>
                  {stats.hasMyShare ? (
                    <>
                      <p className="text-xl font-extrabold" style={{ color: INDIGO }}>${stats.mySplitwiseShare.toFixed(2)}</p>
                      <p className="text-[11px] text-subtle mt-0.5">across {stats.mySplitwiseShareCount} expense{stats.mySplitwiseShareCount !== 1 ? 's' : ''}</p>
                    </>
                  ) : (
                    <p className="text-sm text-subtle mt-1">Couldn't match your Splitwise profile</p>
                  )}
                </div>
              </div>

              {/* Top merchants */}
              {stats.topMerchants.length > 0 && (
                <div className="anim-fade-up">
                  <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Top merchants</p>
                  <div className="bg-surface rounded-2xl border border-edge shadow-sm overflow-hidden">
                    {stats.topMerchants.map((m, i) => {
                      const pct = stats.topMerchants[0].amount ? (m.amount / stats.topMerchants[0].amount) * 100 : 0;
                      return (
                        <div key={m.merchant} className={`px-4 py-3 ${i < stats.topMerchants.length - 1 ? 'border-b border-edge' : ''}`}>
                          <div className="flex items-center justify-between mb-1.5 gap-2">
                            <span className="text-sm font-semibold text-ink truncate">{m.merchant}</span>
                            <span className="text-sm font-bold text-ink shrink-0">${m.amount.toFixed(2)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: INDIGO }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Top categories */}
              {stats.topCategories.length > 0 && (
                <div className="anim-fade-up">
                  <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">By category</p>
                  <div className="bg-surface rounded-2xl border border-edge shadow-sm overflow-hidden">
                    {stats.topCategories.map((c, i) => {
                      const pct = stats.topCategories[0].amount ? (c.amount / stats.topCategories[0].amount) * 100 : 0;
                      return (
                        <button
                          key={c.category}
                          onClick={() => setSelectedCategory(c.category)}
                          className={`w-full text-left px-4 py-3 hover:bg-surface-alt transition-colors ${i < stats.topCategories.length - 1 ? 'border-b border-edge' : ''}`}
                        >
                          <div className="flex items-center justify-between mb-1.5 gap-2">
                            <span className="text-sm font-semibold text-ink">{getCategoryIcon(c.category)} {c.category}</span>
                            <span className="text-sm font-bold text-ink shrink-0">${c.amount.toFixed(2)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: EMERALD }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Chat */}
              <div className="anim-fade-up">
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Ask about your spending</p>
                <div className="bg-surface rounded-2xl border border-edge shadow-sm overflow-hidden flex flex-col">
                  <div ref={scrollRef} className="max-h-80 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {SUGGESTIONS.map(s => (
                          <button
                            key={s}
                            onClick={() => send(s)}
                            className="text-left text-xs font-semibold px-3 py-2 rounded-xl border border-edge text-muted hover:border-indigo-200 hover:text-indigo-500 transition-colors"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : (
                      messages.map((m, i) => (
                        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                              m.role === 'user'
                                ? 'text-white rounded-br-md'
                                : 'bg-surface-alt text-ink rounded-bl-md'
                            }`}
                            style={m.role === 'user' ? { background: INDIGO } : {}}
                          >
                            {m.content}
                          </div>
                        </div>
                      ))
                    )}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-surface-alt rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-2 text-subtle text-sm">
                          <Loader2 size={14} className="animate-spin" /> Thinking…
                        </div>
                      </div>
                    )}
                    {chatError && (
                      <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                        <AlertCircle size={14} className="text-red-500 shrink-0" />
                        <p className="text-xs text-red-600 font-medium">{chatError}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 p-3 border-t border-edge">
                    <input
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') send(); }}
                      placeholder="Ask a question…"
                      disabled={chatLoading}
                      className="flex-1 text-sm bg-surface-alt border border-edge rounded-xl px-3.5 py-2.5 outline-none focus:border-indigo-200 disabled:opacity-60"
                    />
                    <button
                      onClick={() => send()}
                      disabled={chatLoading || !input.trim()}
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 btn-press disabled:opacity-40"
                      style={{ background: INDIGO }}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      <BottomNav />

      {selectedCategory && stats && (
        <CategoryDetail
          category={selectedCategory}
          total={stats.topCategories.find(c => c.category === selectedCategory)?.amount || 0}
          items={stats.itemizedTransactions.filter(t => (t.category || 'Other') === selectedCategory)}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </div>
  );
}
