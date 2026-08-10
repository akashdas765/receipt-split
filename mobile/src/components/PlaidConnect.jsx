import React, { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { Landmark, Loader2, CheckCircle2, RefreshCw, Unlink, AlertCircle, Plus, CreditCard, Pencil } from 'lucide-react';
import { session } from '../services/session';
import { createLinkToken, exchangePublicToken, fetchAccounts, defaultAccountType } from '../services/plaid';
import { syncPlaidConnection } from '../services/plaidSync';
import { savePlaidConnection, deletePlaidConnection, renameTransactionsSource } from '../services/db';
import { accountLabel } from '../utils/accountLabel';

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
//
// One tab per connected LOGIN (Plaid "Item"), not per card — a single
// Chase login can cover several cards/accounts under one connection, and
// there's only one Sync action per login regardless. What actually
// separates those cards apart (in Loaded Statements, All Transactions,
// Reports, everywhere downstream) is doSync() splitting one sync's results
// back out per account before handing them to onAdd — see below.
export default function PlaidConnect({ onAdd, onRenameSource }) {
  const [connections,  setConnections]  = useState(() => session.getPlaidConnections());
  const [activeItemId, setActiveItemId] = useState(() => session.getPlaidConnections()[0]?.itemId || null);
  const [linkToken,     setLinkToken]     = useState(null);
  const [connecting,    setConnecting]    = useState(false);
  const [syncingId,     setSyncingId]     = useState(null);
  const [fullSyncId,    setFullSyncId]    = useState(null); // itemId currently doing a full-history re-sync
  const [errors,        setErrors]        = useState({}); // itemId (or 'new') -> message
  const [lastSyncedMap, setLastSyncedMap] = useState({});
  const [editingAccountId, setEditingAccountId] = useState(null); // account id currently being renamed

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

  const doSync = useCallback(async (conn, { full = false } = {}) => {
    setSyncingId(conn.itemId);
    if (full) setFullSyncId(conn.itemId);
    setErrors(e => ({ ...e, [conn.itemId]: '' }));
    try {
      const current = session.getPlaidConnection(conn.itemId) || conn;
      const { cursor } = await syncPlaidConnection(current, { full, onAdd });

      session.upsertPlaidConnection({ itemId: conn.itemId, cursor });
      await savePlaidConnection({ itemId: conn.itemId, cursor });
      refreshConnections();
      setLastSyncedMap(m => ({ ...m, [conn.itemId]: new Date() }));
    } catch (err) {
      setErrors(e => ({ ...e, [conn.itemId]: err?.message || 'Could not sync transactions.' }));
    } finally {
      setSyncingId(null);
      setFullSyncId(null);
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
        const accounts = (metadata?.accounts || []).map(a => ({
          id: a.id, name: a.name, mask: a.mask,
          ...(defaultAccountType(a.type) ? { accountType: defaultAccountType(a.type) } : {}),
        }));
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

  // Backfills accounts for connections made before this app captured Link's
  // onSuccess metadata (that only fires once, at connect time) — without
  // this, an older connection would show generic single-labeled entries
  // even after a full re-sync, since doSync's per-card labels come from
  // this list.
  useEffect(() => {
    if (!active || (active.accounts && active.accounts.length > 0)) return;
    let cancelled = false;
    fetchAccounts(active.accessToken).then(async rawAccounts => {
      if (cancelled || !rawAccounts.length) return;
      const accounts = rawAccounts.map(({ type, ...a }) => ({
        ...a,
        ...(defaultAccountType(type) ? { accountType: defaultAccountType(type) } : {}),
      }));
      session.upsertPlaidConnection({ itemId: active.itemId, accounts });
      await savePlaidConnection({ itemId: active.itemId, accounts });
      refreshConnections();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [active?.itemId, active?.accessToken]);

  // Renaming a card updates its stored nickname (so future syncs use it)
  // and relabels every transaction already synced from it (so existing
  // Loaded Statements/Reports tabs pick up the new name immediately,
  // instead of only from the next sync onward).
  const saveNickname = useCallback(async (acct, rawValue) => {
    setEditingAccountId(null);
    const nickname = rawValue.trim();
    if (nickname === (acct.nickname || '')) return;
    if (!active) return;

    // Firestore rejects explicit `undefined` field values, so clearing a
    // nickname has to drop the key entirely rather than null it out.
    const updatedAccounts = (active.accounts || []).map(a => {
      if (a.id !== acct.id) return a;
      const { nickname: _old, ...rest } = a;
      return nickname ? { ...rest, nickname } : rest;
    });
    session.upsertPlaidConnection({ itemId: active.itemId, accounts: updatedAccounts });
    await savePlaidConnection({ itemId: active.itemId, accounts: updatedAccounts });
    refreshConnections();

    const source = `plaid-${active.itemId}-${acct.id}`;
    const label  = accountLabel({ ...acct, nickname });
    await renameTransactionsSource(source, label);
    onRenameSource?.(source, label);
  }, [active, onRenameSource]);

  // Plaid doesn't reliably expose "is this checking or a credit card" the
  // same way across every institution, so it's a plain user-set tag —
  // toggled by tapping the chip's icon, independent of renaming. Doesn't
  // touch stored transactions (unlike nickname), just the account's own
  // metadata, since nothing downstream keys off it yet.
  const saveAccountType = useCallback(async (acct, accountType) => {
    if (!active) return;
    const updatedAccounts = (active.accounts || []).map(a => a.id === acct.id ? { ...a, accountType } : a);
    session.upsertPlaidConnection({ itemId: active.itemId, accounts: updatedAccounts });
    await savePlaidConnection({ itemId: active.itemId, accounts: updatedAccounts });
    refreshConnections();
  }, [active]);

  return (
    <div className="bg-surface rounded-2xl p-4 border border-edge shadow-sm space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
          <Landmark size={16} style={{ color: INDIGO }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink">
            {connections.length ? 'Connected banks' : 'Connect your bank'}
          </p>
          <p className="text-xs text-subtle">
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
        <div className="flex flex-wrap gap-2">
          {connections.map(c => (
            <button
              key={c.itemId}
              onClick={() => setActiveItemId(c.itemId)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors btn-press ${
                activeItemId === c.itemId ? 'text-white' : 'bg-surface text-muted border border-edge hover:border-indigo-200'
              }`}
              style={activeItemId === c.itemId ? { background: INDIGO } : {}}
            >
              {c.institutionName || 'Bank'}
            </button>
          ))}
          <button
            onClick={startConnect}
            disabled={connecting}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border-2 border-dashed border-edge text-subtle hover:border-indigo-300 hover:text-indigo-500 transition-colors btn-press disabled:opacity-60"
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
                editingAccountId === a.id ? (
                  <input
                    key={a.id}
                    autoFocus
                    defaultValue={a.nickname || ''}
                    placeholder={accountLabel({ ...a, nickname: undefined })}
                    onBlur={e => saveNickname(a, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditingAccountId(null);
                    }}
                    className="text-[11px] font-semibold text-ink bg-surface border-2 rounded-full px-2 py-1 outline-none w-32"
                    style={{ borderColor: INDIGO }}
                  />
                ) : (
                  <span
                    key={a.id}
                    className="flex items-center gap-0.5 text-[11px] font-semibold text-muted bg-surface-alt border border-edge rounded-full pl-1 pr-2 py-1"
                  >
                    <button
                      onClick={() => saveAccountType(a, a.accountType === 'bank' ? 'credit' : 'bank')}
                      title={a.accountType === 'bank' ? 'Bank account — tap to mark as credit card' : 'Credit card — tap to mark as bank account'}
                      className="flex items-center justify-center w-5 h-5 rounded-full hover:bg-surface-alt hover:text-indigo-500 transition-colors shrink-0"
                    >
                      {a.accountType === 'bank' ? <Landmark size={10} /> : <CreditCard size={10} />}
                    </button>
                    <button
                      onClick={() => setEditingAccountId(a.id)}
                      title="Tap to rename this card"
                      className="flex items-center gap-1 pl-0.5 hover:text-indigo-500 transition-colors"
                    >
                      {accountLabel(a)} <Pencil size={9} className="opacity-50" />
                    </button>
                  </span>
                )
              ))}
            </div>
          )}
          <p className="text-xs text-subtle">
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
              {syncingId === active.itemId && !fullSyncId ? <><Loader2 size={15} className="animate-spin" /> Syncing…</> : <><RefreshCw size={14} /> Sync now</>}
            </button>
            <button
              onClick={() => disconnect(active.itemId)}
              title="Disconnect"
              className="px-3 py-2.5 rounded-xl text-sm font-bold text-red-400 border-2 border-red-100 hover:bg-red-50 transition-colors btn-press"
            >
              <Unlink size={15} />
            </button>
          </div>
          {/* Manual fallback — StatementsPage.jsx auto-detects and fixes
              legacy-format transactions (pre-per-account-split) on load, so
              this shouldn't normally be needed, but stays as a way to force
              a full re-sync regardless of account count (a single-account
              connection can carry the legacy format just as easily as a
              multi-account one — no reason to gate this on account count). */}
          <button
            onClick={() => doSync(active, { full: true })}
            disabled={syncingId === active.itemId}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-indigo-500 hover:bg-indigo-50 transition-colors btn-press disabled:opacity-60"
          >
            {fullSyncId === active.itemId ? <><Loader2 size={12} className="animate-spin" /> Re-tagging past transactions by card…</> : 'Re-split older transactions by card'}
          </button>
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
