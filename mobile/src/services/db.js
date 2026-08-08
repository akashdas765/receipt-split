import {
  collection, doc, getDocs, setDoc, deleteDoc,
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

// ── Plaid bank connection (see services/plaid.js, components/PlaidConnect.jsx) ──
// Stored directly on the user doc, same as splitwise_api_key — already
// covered by that doc's existing per-user Firestore rule, no new rule
// needed. Partial: only pass the fields that changed (e.g. just `cursor`
// after a sync) so the others aren't clobbered with undefined.

function userDoc() {
  return doc(db, 'users', session.getUserId());
}

export async function savePlaidConnection({ accessToken, itemId, cursor, institutionName } = {}) {
  const data = {};
  if (accessToken     !== undefined) data.plaid_access_token     = accessToken;
  if (itemId          !== undefined) data.plaid_item_id          = itemId;
  if (cursor          !== undefined) data.plaid_cursor           = cursor;
  if (institutionName !== undefined) data.plaid_institution_name = institutionName;
  await setDoc(userDoc(), data, { merge: true });
}

export async function clearPlaidConnection() {
  await setDoc(userDoc(), {
    plaid_access_token: null,
    plaid_item_id: null,
    plaid_cursor: null,
    plaid_institution_name: null,
  }, { merge: true });
}
