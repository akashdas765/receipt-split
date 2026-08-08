import React, { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Landmark, Loader2, CheckCircle2, RefreshCw, Unlink, AlertCircle, Plus, CreditCard } from 'lucide-react';
import { session } from '../services/session';
import { createLinkToken, exchangePublicToken, syncTransactions } from '../services/plaid';
import { savePlaidConnection, deletePlaidConnection, deleteTransaction } from '../services/db';

const INDIGO = '#6366f1';

// Persists the link_token across the OAuth redirect — Chase (and other
// OAuth institutions) briefly navigate the whole page away to their own
// login and back, which clears normal component state, so this has to
// survive in storage rather than a variable.
const OAUTH_STORAGE_KEY = 'plaid_oauth_link_token';

function accountLabel(acct) {
  if (!acct) return 'Account';
  const name = acct.name || acct.official_name || 'Account';
  return acct.mask ? `${name} ...${acct.mask}` : name;
}

// Auto-import via Plaid Link — an alternative to manual CSV/PDF upload
// (StatementUpload.jsx). Reuses the same onAdd callback StatementsPage
// already passes to StatementUpload, so synced transactions flow through
// the exact same Firestore write + "Loaded statements" grouping.
//
// One tab per connected LOGIN (Plaid "Item"), not per card — a single
// Chase login can cover several cards/accounts under one connection, and
// there's only one Sync action per login regardless. What actually
// separates those cards apart (in Loaded Statements, All Transactions,
// Reports, everywhere downstream) is doSync() splitting one sync's results
// back out per account before handing them to onAdd — see below.
export default function PlaidConnect({ onAdd }) {
  const [connections,  setConnections]  = useState(() => session.getPlaidConnections());
  const [activeItemId, setActiveItemId] = useState(() => session.getPlaidConnections()[0]?.itemId || null);
  const [linkToken,     setLinkToken]     = useState(null);
  const [connecting,    setConnecting]    = useState(false);
  const [syncingId,     setSyncingId]     = useState(null);
  const [errors,        setErrors]        = useState({}); // itemId (or 'new') -> message
  const [lastSyncedMap, setLastSyncedMap] = useState({});

  // Set once at mount — Plaid appends this after redirecting back from an
  // OAuth institution's own login page (Sandbox never does this, so this
  // stays false there).
  const [isOAuthRedirect] = useState(() => window.location.search.includes('oauth_state_id'));

  useEffect(() => {
    if (!isOAuthRedirect) return;
    const stored = window.localStorage.getItem(OAUTH_STORAGE_KEY);
    if (stored) {
      setLinkToken(stored);
      setConnecting(true);
    }
  }, [isOAuthRedirect]);

  const refreshConnections = () => setConnections(session.getPlaidConnections());

  const doSync = useCallback(async (conn) => {
    setSyncingId(conn.itemId);
    setErrors(e => ({ ...e, [conn.itemId]: '' }));
    try {
      const current = session.getPlaidConnection(conn.itemId) || conn;
      const result  = await syncTransactions(current.accessToken, current.cursor);

      if (result.transactions.length) {
        // Split one sync's results back out per card — a single login can
        // cover several accounts, so lumping them all under one source
        // would undo the whole point of telling them apart.
        const byAccount = new Map();
        result.transactions.forEach(t => {
          const key = t.accountId || 'unknown';
          if (!byAccount.has(key)) byAccount.set(key, []);
          byAccount.get(key).push(t);
        });
        const accounts = current.accounts || [];
        for (const [accountId, txns] of byAccount) {
          const acct  = accounts.find(a => a.id === accountId);
          const label = acct ? accountLabel(acct) : (current.institutionName || 'Bank (Plaid)');
          const withSource = txns.map(t => ({ ...t, source: `plaid-${conn.itemId}-${accountId}` }));
          await onAdd(withSource, label);
        }
      }

      for (const id of result.removedIds) {
        await deleteTransaction(id).catch(() => {});
      }

      session.upsertPlaidConnection({ itemId: conn.itemId, cursor: result.cursor });
      await savePlaidConnection({ itemId: conn.itemId, cursor: result.cursor });
      refreshConnections();
      setLastSyncedMap(m => ({ ...m, [conn.itemId]: new Date() }));
    } catch (err) {
      setErrors(e => ({ ...e, [conn.itemId]: err?.message || 'Could not sync transactions.' }));
    } finally {
      setSyncingId(null);
    }
  }, [onAdd]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    // Only set during OAuth resume — telling Link "you're coming back from
    // the institution's own login page" is what lets it complete the flow
    // instead of treating this as a fresh session.
    ...(isOAuthRedirect ? { receivedRedirectUri: window.location.href } : {}),
    onSuccess: async (publicToken, metadata) => {
      window.localStorage.removeItem(OAUTH_STORAGE_KEY);
      setErrors(e => ({ ...e, new: '' }));
      try {
        const { accessToken, itemId } = await exchangePublicToken(publicToken);
        const institutionName = metadata?.institution?.name || null;
        // Every card/account the user selected under this one login —
        // captured now since Link's onSuccess is the only place this
        // (name/mask) is available; /transactions/sync only returns bare
        // account_ids, not human-readable labels.
        const accounts = (metadata?.accounts || []).map(a => ({ id: a.id, name: a.name, mask: a.mask }));
        const conn = { itemId, accessToken, cursor: null, institutionName, accounts };
        session.upsertPlaidConnection(conn);
        await savePlaidConnection(conn);
        refreshConnections();
        setActiveItemId(itemId);
        await doSync(conn);
      } catch (err) {
        setErrors(e => ({ ...e, new: err?.message || 'Could not connect your bank.' }));
      } finally {
        setConnecting(false);
        setLinkToken(null);
        // Drop ?oauth_state_id=... so refreshing this page doesn't try to
        // resume an already-finished (or now stale) OAuth session.
        if (isOAuthRedirect) window.history.replaceState({}, '', window.location.pathname);
      }
    },
    onExit: (err) => {
      window.localStorage.removeItem(OAUTH_STORAGE_KEY);
      setConnecting(false);
      setLinkToken(null);
      if (err) setErrors(e => ({ ...e, new: err.error_message || 'Bank connection cancelled.' }));
      if (isOAuthRedirect) window.history.replaceState({}, '', window.location.pathname);
    },
  });

  // Plaid Link opens itself once its token is ready — usePlaidLink can't
  // be told to fetch-then-open in one step since the token has to exist
  // before the hook can render its handler.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const startConnect = async () => {
    setConnecting(true);
    setErrors(e => ({ ...e, new: '' }));
    try {
      const token = await createLinkToken();
      // Persisted so it survives the full-page navigation OAuth
      // institutions do — a plain state variable wouldn't still be there
      // when the user lands back on this page.
      window.localStorage.setItem(OAUTH_STORAGE_KEY, token);
      setLinkToken(token);
    } catch (err) {
      setErrors(e => ({ ...e, new: err?.message || 'Could not start bank connection.' }));
      setConnecting(false);
    }
  };

  const disconnect = async (itemId) => {
    await deletePlaidConnection(itemId);
    session.removePlaidConnection(itemId);
    const updated = session.getPlaidConnections();
    setConnections(updated);
    if (activeItemId === itemId) setActiveItemId(updated[0]?.itemId || null);
  };

  const active = connections.find(c => c.itemId === activeItemId) || null;

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
          <Landmark size={16} style={{ color: INDIGO }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800">
            {connections.length ? 'Connected banks' : 'Connect your bank'}
          </p>
          <p className="text-xs text-slate-400">
            {connections.length ? 'Auto-import via Plaid' : 'Auto-import via Plaid — no manual CSV/PDF needed'}
          </p>
        </div>
        {connections.length > 0 && <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />}
      </div>

      {errors.new && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <AlertCircle size={13} className="text-red-500 shrink-0" />
          <p className="text-xs text-red-600 font-medium">{errors.new}</p>
        </div>
      )}

      {connections.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {connections.map(c => (
            <button
              key={c.itemId}
              onClick={() => setActiveItemId(c.itemId)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors btn-press ${
                activeItemId === c.itemId ? 'text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-200'
              }`}
              style={activeItemId === c.itemId ? { background: INDIGO } : {}}
            >
              {c.institutionName || 'Bank'}
            </button>
          ))}
          <button
            onClick={startConnect}
            disabled={connecting}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border-2 border-dashed border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors btn-press disabled:opacity-60"
          >
            {connecting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
          </button>
        </div>
      )}

      {active ? (
        <div className="space-y-2">
          {active.accounts?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {active.accounts.map(a => (
                <span key={a.id} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-1">
                  <CreditCard size={10} /> {accountLabel(a)}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400">
            {lastSyncedMap[active.itemId] ? `Last synced ${lastSyncedMap[active.itemId].toLocaleTimeString()}` : 'Tap Sync to pull transactions'}
          </p>
          {errors[active.itemId] && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <AlertCircle size={13} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600 font-medium">{errors[active.itemId]}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => doSync(active)}
              disabled={syncingId === active.itemId}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors btn-press disabled:opacity-60"
              style={{ borderColor: '#c7d2fe', color: INDIGO }}
            >
              {syncingId === active.itemId ? <><Loader2 size={15} className="animate-spin" /> Syncing…</> : <><RefreshCw size={14} /> Sync now</>}
            </button>
            <button
              onClick={() => disconnect(active.itemId)}
              title="Disconnect"
              className="px-3 py-2.5 rounded-xl text-sm font-bold text-red-400 border-2 border-red-100 hover:bg-red-50 transition-colors btn-press"
            >
              <Unlink size={15} />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={startConnect}
          disabled={connecting}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-sm font-bold btn-gradient btn-press disabled:opacity-60"
        >
          {connecting ? <><Loader2 size={15} className="animate-spin" /> Connecting…</> : 'Connect bank'}
        </button>
      )}
    </div>
  );
}
