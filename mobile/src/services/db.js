import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, orderBy, limit, where, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { session } from './session';

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

const TXN_MAX = 1000;

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
export async function addTransactions(transactions, sourceName) {
  const batch      = writeBatch(db);
  const uploadedAt = new Date().toISOString();
  transactions.forEach(txn => {
    const { id, ...data } = txn;
    batch.set(doc(transactionsCol(), id), { ...data, sourceName, uploadedAt });
  });
  await batch.commit();
}

export async function setTransactionOverride(id, overrideFields) {
  await setDoc(doc(transactionsCol(), id), overrideFields, { merge: true });
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
