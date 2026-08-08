import React, { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Landmark, Loader2, CheckCircle2, RefreshCw, Unlink, AlertCircle } from 'lucide-react';
import { session } from '../services/session';
import { createLinkToken, exchangePublicToken, syncTransactions } from '../services/plaid';
import { savePlaidConnection, clearPlaidConnection, deleteTransaction } from '../services/db';

const INDIGO = '#6366f1';

// Persists the link_token across the OAuth redirect — Chase (and other
// OAuth institutions) briefly navigate the whole page away to their own
// login and back, which clears normal component state, so this has to
// survive in storage rather than a variable.
const OAUTH_STORAGE_KEY = 'plaid_oauth_link_token';

// Auto-import via Plaid Link — an alternative to manual CSV/PDF upload
// (StatementUpload.jsx). Reuses the same onAdd callback StatementsPage
// already passes to StatementUpload, so synced transactions flow through
// the exact same Firestore write + "Loaded statements" grouping.
export default function PlaidConnect({ onAdd }) {
  const initial = session.getPlaid();
  const [connected,       setConnected]       = useState(!!initial.accessToken);
  const [institutionName, setInstitutionName] = useState(initial.institutionName);
  const [linkToken,       setLinkToken]       = useState(null);
  const [connecting,      setConnecting]      = useState(false);
  const [syncing,         setSyncing]         = useState(false);
  const [error,           setError]           = useState('');
  const [lastSynced,      setLastSynced]      = useState(null);

  // Set once at mount — Plaid appends this after redirecting back from an
  // OAuth institution's own login page (Sandbox never does this, so this
  // stays false there).
  const [isOAuthRedirect] = useState(() => window.location.search.includes('oauth_state_id'));

  // Resume: re-hydrate the token that existed before the page navigated
  // away for OAuth login, instead of starting a fresh Link session.
  useEffect(() => {
    if (!isOAuthRedirect) return;
    const stored = window.localStorage.getItem(OAUTH_STORAGE_KEY);
    if (stored) {
      setLinkToken(stored);
      setConnecting(true);
    }
  }, [isOAuthRedirect]);

  const doSync = useCallback(async (overrideAccessToken) => {
    const { accessToken, cursor, itemId } = session.getPlaid();
    const token = overrideAccessToken || accessToken;
    if (!token) return;

    setSyncing(true);
    setError('');
    try {
      const result = await syncTransactions(token, cursor);
      if (result.transactions.length) {
        // Stable per-connection source id (not per-sync) so repeated syncs
        // group under one "Loaded statement" entry instead of a new one
        // each time — matches how StatementUpload's own grouping works.
        const withSource = result.transactions.map(t => ({ ...t, source: `plaid-${itemId}` }));
        await onAdd(withSource, session.getPlaid().institutionName || 'Bank (Plaid)');
      }
      for (const id of result.removedIds) {
        await deleteTransaction(id).catch(() => {});
      }
      session.setPlaid({ cursor: result.cursor });
      await savePlaidConnection({ cursor: result.cursor });
      setLastSynced(new Date());
    } catch (err) {
      setError(err?.message || 'Could not sync transactions.');
    } finally {
      setSyncing(false);
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
      setError('');
      try {
        const { accessToken, itemId } = await exchangePublicToken(publicToken);
        const institution = metadata?.institution?.name || null;
        session.setPlaid({ accessToken, itemId, cursor: null, institutionName: institution });
        await savePlaidConnection({ accessToken, itemId, cursor: null, institutionName: institution });
        setConnected(true);
        setInstitutionName(institution);
        await doSync(accessToken);
      } catch (err) {
        setError(err?.message || 'Could not connect your bank.');
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
      if (err) setError(err.error_message || 'Bank connection cancelled.');
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
    setError('');
    try {
      const token = await createLinkToken();
      // Persisted so it survives the full-page navigation OAuth
      // institutions do — a plain state variable wouldn't still be there
      // when the user lands back on this page.
      window.localStorage.setItem(OAUTH_STORAGE_KEY, token);
      setLinkToken(token);
    } catch (err) {
      setError(err?.message || 'Could not start bank connection.');
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    await clearPlaidConnection();
    session.setPlaid({ accessToken: null, itemId: null, cursor: null, institutionName: null });
    setConnected(false);
    setInstitutionName(null);
    setLastSynced(null);
  };

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
          <Landmark size={16} style={{ color: INDIGO }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 truncate">
            {connected ? `Connected: ${institutionName || 'Bank'}` : 'Connect your bank'}
          </p>
          <p className="text-xs text-slate-400">
            {connected
              ? lastSynced ? `Last synced ${lastSynced.toLocaleTimeString()}` : 'Tap Sync to pull transactions'
              : 'Auto-import via Plaid — no manual CSV/PDF needed'}
          </p>
        </div>
        {connected && <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <AlertCircle size={13} className="text-red-500 shrink-0" />
          <p className="text-xs text-red-600 font-medium">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        {!connected ? (
          <button
            onClick={startConnect}
            disabled={connecting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-sm font-bold btn-gradient btn-press disabled:opacity-60"
          >
            {connecting ? <><Loader2 size={15} className="animate-spin" /> Connecting…</> : 'Connect bank'}
          </button>
        ) : (
          <>
            <button
              onClick={() => doSync()}
              disabled={syncing}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold border-2 transition-colors btn-press disabled:opacity-60"
              style={{ borderColor: '#c7d2fe', color: INDIGO }}
            >
              {syncing ? <><Loader2 size={15} className="animate-spin" /> Syncing…</> : <><RefreshCw size={14} /> Sync now</>}
            </button>
            <button
              onClick={disconnect}
              title="Disconnect"
              className="px-3 py-2.5 rounded-xl text-sm font-bold text-red-400 border-2 border-red-100 hover:bg-red-50 transition-colors btn-press"
            >
              <Unlink size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
