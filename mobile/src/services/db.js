import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, orderBy, limit, where, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { session } from './session';
import { fetchCurrentUser } from './splitwise';
import { isPaymentTransaction, isCreditConfirmation, isIncomeTransaction } from '../utils/paymentDetector';

function receiptsCol() {
  return collection(db, 'users', session.getUserId(), 'receipts');
}

function transactionsCol() {
  return collection(db, 'users', session.getUserId(), 'transactions');
}

// Single-shot fetch (no pagination) — used by HomePage's month view and by
// Insights; both want a broad recent window filtered/aggregated client-side
// rather than paged.
export async function loadReceiptsForInsights(max = 200) {
  try {
    const q    = query(receiptsCol(), orderBy('scanned_at', 'desc'), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function saveReceipt(receipt) {
  const { id, ...data } = receipt;
  await setDoc(doc(receiptsCol(), id), data, { merge: true });
}

export async function deleteReceipt(id) {
  await deleteDoc(doc(receiptsCol(), id));
}

// ── Bank/manual transactions (Statements feature) ──────────────────────────
// One doc per transaction. Match-override state (overrideSplitwiseId /
// overrideForcedUnmatched / overrideExpenseData — see utils/matcher.js)
// lives directly on the doc rather than a separate collection, and the
// "loaded statements" list shown in the Upload tab is derived client-side
// by grouping on `source`/`sourceName` rather than stored separately.

export const TXN_MAX = 1000;

export async function loadTransactions() {
  try {
    const q    = query(transactionsCol(), orderBy('date', 'desc'), limit(TXN_MAX));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

// transactions: parsed/manual entries missing only sourceName/uploadedAt,
// which get stamped on here so the Upload tab can group and label them.
// merge:true so re-adding an already-stored transaction (e.g. a Plaid full
// history re-sync, re-tagging older rows with the right per-card source)
// updates its fields without wiping any overrideSplitwiseId/etc. the user
// already set via setTransactionOverride.
export async function addTransactions(transactions, sourceName) {
  const batch      = writeBatch(db);
  const uploadedAt = new Date().toISOString();
  transactions.forEach(txn => {
    const { id, ...data } = txn;
    batch.set(doc(transactionsCol(), id), { ...data, sourceName, uploadedAt }, { merge: true });
  });
  await batch.commit();
}

export async function setTransactionOverride(id, overrideFields) {
  await setDoc(doc(transactionsCol(), id), overrideFields, { merge: true });
}

// Manual category correction from TransactionsList — separate from
// setTransactionOverride's Splitwise-match fields since category isn't a
// match-override, just a direct field update (same merge:true pattern).
export async function updateTransactionCategory(id, category) {
  await setDoc(doc(transactionsCol(), id), { category }, { merge: true });
}

// Single-doc lookup by id — used by plaidSync.js to find a pending
// transaction's doc (by its stable id) when the posted transaction that
// supersedes it arrives, so any Splitwise match already set on the pending
// row can be carried forward before that row is deleted.
export async function getTransaction(id) {
  const snap = await getDoc(doc(transactionsCol(), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function deleteTransaction(id) {
  await deleteDoc(doc(transactionsCol(), id));
}

// Removes every transaction from one uploaded statement/batch (identified
// by its `source` id) — used when the user removes a loaded statement.
export async function deleteTransactionsBySource(source) {
  const snap  = await getDocs(query(transactionsCol(), where('source', '==', source)));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// One-time fix for transactions saved before their description was checked
// against the payment/income patterns (e.g. "Payment Thank You" entries
// synced before Plaid credits were even kept, or income patterns added
// after a paycheck was already synced — see services/plaid.js) — isPayment/
// isIncome are stamped once per doc at write time, not recomputed live, so
// already-stored rows stay misclassified until something corrects them.
// `transactions` is the caller's already-loaded full list (avoids a second
// fetch); returns [{id, fields}] for whichever rows were actually updated.
export async function reclassifyTransactions(transactions) {
  const toFix = transactions
    .map(t => {
      const fields = {};
      if (!t.isPayment && isPaymentTransaction(t.description)) {
        fields.isPayment = true;
        if (isCreditConfirmation(t.description)) fields.isCredit = true;
      }
      // Income patterns only make sense on a credit — a debit whose
      // description happens to match (unlikely, but not impossible) isn't
      // money coming in just because the wording matches.
      if (!t.isIncome && t.isCredit && isIncomeTransaction(t.description)) {
        fields.isIncome = true;
      }
      return { id: t.id, fields };
    })
    .filter(({ fields }) => Object.keys(fields).length > 0);
  if (!toFix.length) return [];
  const batch = writeBatch(db);
  toFix.forEach(({ id, fields }) => batch.update(doc(transactionsCol(), id), fields));
  await batch.commit();
  return toFix;
}

// Relabels every already-stored transaction from one statement/card (e.g.
// after the user nicknames a Plaid-linked card) — without this, a rename
// would only take effect for future syncs, since sourceName is stamped
// once per transaction doc at addTransactions() time, not looked up live.
export async function renameTransactionsSource(source, sourceName) {
  const snap  = await getDocs(query(transactionsCol(), where('source', '==', source)));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { sourceName }));
  await batch.commit();
}

// ── Plaid bank connections (see services/plaid.js, components/PlaidConnect.jsx) ──
// One doc per connected account (Chase, Amex, ...), keyed by Plaid's own
// itemId — lets each be synced/disconnected independently instead of one
// connection overwriting another. Partial: only pass the fields that
// changed (e.g. just `cursor` after a sync) so the others aren't clobbered.

function userDoc() {
  return doc(db, 'users', session.getUserId());
}

function plaidConnectionsCol() {
  return collection(db, 'users', session.getUserId(), 'plaidConnections');
}

export async function loadPlaidConnections() {
  try {
    const snap = await getDocs(plaidConnectionsCol());
    return snap.docs.map(d => ({ itemId: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function savePlaidConnection({ itemId, accessToken, cursor, institutionName, accounts } = {}) {
  if (!itemId) throw new Error('savePlaidConnection requires itemId');
  const data = {};
  if (accessToken     !== undefined) data.accessToken     = accessToken;
  if (cursor          !== undefined) data.cursor          = cursor;
  if (institutionName !== undefined) data.institutionName = institutionName;
  // The cards/accounts covered by this one login (e.g. 3 Chase cards under
  // one Item) — [{ id, name, mask }], captured from Plaid Link's onSuccess
  // metadata at connect time. Lets synced transactions be split back out
  // per card instead of lumped into one "Chase" group.
  if (accounts        !== undefined) data.accounts        = accounts;
  await setDoc(doc(plaidConnectionsCol(), itemId), data, { merge: true });
}

export async function deletePlaidConnection(itemId) {
  await deleteDoc(doc(plaidConnectionsCol(), itemId));
}

// One-time migration: before multi-account support, the single Plaid
// connection lived as flat plaid_access_token/plaid_item_id/... fields
// directly on the user doc. Moves that into the plaidConnections
// subcollection (as its first entry) so an already-connected account isn't
// lost, then clears the old fields so this is a no-op on every later call.
export async function migrateLegacyPlaidConnection() {
  const snap = await getDoc(userDoc());
  if (!snap.exists()) return;
  const data = snap.data();
  if (!data.plaid_access_token || !data.plaid_item_id) return;
  await savePlaidConnection({
    itemId:          data.plaid_item_id,
    accessToken:     data.plaid_access_token,
    cursor:          data.plaid_cursor || null,
    institutionName: data.plaid_institution_name || null,
  });
  await setDoc(userDoc(), {
    plaid_access_token: null,
    plaid_item_id: null,
    plaid_cursor: null,
    plaid_institution_name: null,
  }, { merge: true });
}

// ── Non-Plaid account classification (see services/session.js's getAccountType) ──
// Plaid accounts already carry a bank/credit tag on plaidConnections'
// accounts[] (see savePlaidConnection above); CSV/PDF/manual transactions
// have no equivalent entity to hang that tag on, since their `source` is
// just a string (an upload-batch label, or 'pdf'/'manual'), not a real
// account id. This gives every non-Plaid `source` string somewhere to store
// the same kind of tag, keyed by that string directly.

function sourceMetaCol() {
  return collection(db, 'users', session.getUserId(), 'sourceMeta');
}

export async function loadSourceMeta() {
  try {
    const snap = await getDocs(sourceMetaCol());
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    return map;
  } catch {
    return {};
  }
}

export async function saveSourceMeta(sourceId, { accountType, label } = {}) {
  if (!sourceId) throw new Error('saveSourceMeta requires sourceId');
  const data = { updatedAt: new Date().toISOString() };
  if (accountType !== undefined) data.accountType = accountType;
  if (label       !== undefined) data.label       = label;
  await setDoc(doc(sourceMetaCol(), sourceId), data, { merge: true });
}

// ── Manual net-worth accounts (see components/NetWorthDetail.jsx) ──────────
// For balances with no transaction feed at all (rewards points, cash, a
// loan you're tracking by hand, ...) — just a name/balance/type the user
// enters directly, folded into HomePage's net worth total alongside the
// live Plaid/Splitwise numbers. type: 'asset' adds to net worth, 'liability'
// subtracts.

function manualAccountsCol() {
  return collection(db, 'users', session.getUserId(), 'manualAccounts');
}

export async function loadManualAccounts() {
  try {
    const snap = await getDocs(manualAccountsCol());
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

// Omit `id` to create a new account (Firestore assigns the id); pass it to
// update an existing one.
export async function saveManualAccount({ id, name, balance, type }) {
  const data = { name, balance, type };
  const ref  = id ? doc(manualAccountsCol(), id) : doc(manualAccountsCol());
  await setDoc(ref, data, { merge: true });
  return ref.id;
}

export async function deleteManualAccount(id) {
  await deleteDoc(doc(manualAccountsCol(), id));
}

// ── Net worth snapshots (trend on HomePage's net-worth card) ───────────────
// Net worth itself is never stored as the source of truth — HomePage always
// recomputes it live from Plaid/Splitwise/manual accounts, since a stale
// number there would be actively misleading (see its own comment). This is
// a separate running history of that computed number, one doc per day
// (merge:true upsert — loading the same day twice just overwrites it with
// the latest computation), purely so a "+X% this month" trend has a real
// past value to compare against instead of a made-up one. Starts empty for
// every user; the trend only appears once enough days have accumulated.
function netWorthSnapshotsCol() {
  return collection(db, 'users', session.getUserId(), 'netWorthSnapshots');
}

export async function saveNetWorthSnapshot(netWorth) {
  const date = new Date().toISOString().slice(0, 10);
  await setDoc(doc(netWorthSnapshotsCol(), date), { date, netWorth }, { merge: true });
}

// Last ~45 days, oldest first — enough slack to still find something ~30
// days back for a month-over-month comparison even if some days were
// skipped (app not opened that day).
export async function loadNetWorthHistory() {
  try {
    const q    = query(netWorthSnapshotsCol(), orderBy('date', 'desc'), limit(45));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data()).reverse();
  } catch {
    return [];
  }
}

// ── Notifications (bell icon on HomePage) ───────────────────────────────────
// A real, persisted log of things that actually happened — written at the
// moment each event occurs (see the logNotification call sites: ScanPage
// after a receipt is parsed, ApprovePage after a receipt posts to
// Splitwise, PlaidConnect after a brand-new bank/card is linked), never
// synthesized from existing data after the fact. read tracks whether the
// user has opened it; the header badge is just the unread count.
function notificationsCol() {
  return collection(db, 'users', session.getUserId(), 'notifications');
}

// receiptId/navigateTo are optional — whatever a NotificationCenter tap
// should do (open a receipt, jump to a page). Omitted entirely rather than
// set to undefined, since Firestore rejects undefined field values outright
// (same reasoning as services/plaid.js's postedDate).
export async function logNotification({ type, text, receiptId, navigateTo }) {
  const ref = doc(notificationsCol());
  await setDoc(ref, {
    type, text, read: false, createdAt: new Date().toISOString(),
    ...(receiptId  !== undefined ? { receiptId }  : {}),
    ...(navigateTo !== undefined ? { navigateTo } : {}),
  });
}

// Most recent 50 — a running feed for the bell icon, not a full audit log.
export async function loadNotifications() {
  try {
    const q    = query(notificationsCol(), orderBy('createdAt', 'desc'), limit(50));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function markNotificationRead(id) {
  await setDoc(doc(notificationsCol(), id), { read: true }, { merge: true });
}

// ── Splitwise key rotation (see components/SettingsPage.jsx) ───────────────
// signup() writes the key once and never again — this is the only update
// path. Every Splitwise call reads the key from the session singleton (see
// services/splitwise.js's swFetch), not a parameter, so validating a
// candidate key means temporarily swapping it into session, probing with
// fetchCurrentUser, and rolling back on failure — that way a bad paste
// never gets written to Firestore or left live in session.
export async function updateSplitwiseKey(key) {
  const previous = session.getKey();
  session.setKey(key);
  try {
    await fetchCurrentUser();
  } catch {
    session.setKey(previous);
    throw new Error('Could not verify this Splitwise API key — check that it was copied correctly.');
  }
  await setDoc(doc(db, 'users', session.getUserId()), { splitwise_api_key: key }, { merge: true });
}
