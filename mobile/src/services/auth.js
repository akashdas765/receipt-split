import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  updatePassword,
  EmailAuthProvider,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { session } from './session';
import { migrateLegacyPlaidConnection, loadPlaidConnections, loadSourceMeta } from './db';

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
  const data = snap.data();
  session.setKey(data.splitwise_api_key);
  session.setUserId(cred.user.uid);
  // Split from the block below on purpose: a migration failure here must
  // not skip loading the connections that already exist post-migration —
  // see the identical split in App.jsx's hydration effect.
  try {
    await migrateLegacyPlaidConnection();
  } catch (err) {
    console.error('migrateLegacyPlaidConnection failed:', err);
  }
  try {
    session.setPlaidConnections(await loadPlaidConnections());
    session.setSourceMeta(await loadSourceMeta());
  } catch (err) {
    console.error('Could not load Plaid connections/source metadata:', err);
  }
  return cred.user;
}

export async function logout() {
  await signOut(auth);
  session.clear();
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// LoginPage's "Forgot password?" — Firebase handles the email delivery and
// the actual reset form (hosted on the project's own auth domain), so this
// app never sees or sets the new password itself.
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// SettingsPage's "Change password". updatePassword requires a *recent*
// sign-in — reauthenticating with the current password first (rather than
// just calling updatePassword and letting Firebase's auth/requires-recent-
// login error surface) means the user never hits that error mid-flow, and
// doubles as verifying they actually know the current password before
// changing it.
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Not signed in.');
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}
