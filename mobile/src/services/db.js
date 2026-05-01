import {
  collection, doc, getDocs, setDoc, deleteDoc,
  query, orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import { session } from './session';

function receiptsCol() {
  return collection(db, 'users', session.getUserId(), 'receipts');
}

export async function loadReceipts() {
  try {
    const q    = query(receiptsCol(), orderBy('scanned_at', 'desc'));
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
