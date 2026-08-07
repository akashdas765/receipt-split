import {
  collection, doc, getDocs, setDoc, deleteDoc,
  query, orderBy, limit, startAfter,
} from 'firebase/firestore';
import { db } from './firebase';
import { session } from './session';

const PAGE_SIZE = 20;

function receiptsCol() {
  return collection(db, 'users', session.getUserId(), 'receipts');
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
