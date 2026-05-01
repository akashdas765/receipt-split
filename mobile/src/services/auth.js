import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { session } from './session';

export async function signup(email, password, splitwiseKey) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    email,
    splitwise_api_key: splitwiseKey,
    created_at: new Date().toISOString(),
  });
  session.setKey(splitwiseKey);
  session.setUserId(cred.user.uid);
  return cred.user;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const snap = await getDoc(doc(db, 'users', cred.user.uid));
  if (!snap.exists()) throw new Error('User profile not found.');
  session.setKey(snap.data().splitwise_api_key);
  session.setUserId(cred.user.uid);
  return cred.user;
}

export async function logout() {
  await signOut(auth);
  session.clear();
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
