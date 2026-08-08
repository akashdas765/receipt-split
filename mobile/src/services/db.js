import {
  collection, doc, getDocs, setDoc, deleteDoc,
  query, orderBy, limit, startAfter, where, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { session } from './session';

const PAGE_SIZE = 20;

function receiptsCol() {
  return collection(db, 'users', session.getUserId(), 'receipts');
}

function transactionsCol() {
  return collection(db, 'users', session.getUserId(), 'transactions');
}

// cursor: the last doc snapshot from a previous page, or null for the first page.
// Returns { receipts, cursor, hasMore } — pass the returned cursor back in to
// fetch the next page.
export async function loadReceipts(cursor = null) {
  try {
    const constraints = [orderBy('scanned_at', 'desc'), limit(PAGE_SIZE)];
    if (cursor) constraints.push(startAfter(cursor));
    const q    = query(receiptsCol(), ...constraints);
    const snap = await getDocs(q);
    return {
      receipts: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      cursor:   snap.docs[snap.docs.length - 1] || null,
      hasMore:  snap.docs.length === PAGE_SIZE,
    };
  } catch {
    return { receipts: [], cursor: null, hasMore: false };
  }
}

// Single-shot fetch (no pagination) used by the Insights page — analysis
// wants a broad recent window, not the 20-at-a-time feed the home list uses.
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
