import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// getAuth() defaults to IndexedDB-only persistence. Some WebKit contexts
// (installed iOS PWAs with partitioned storage, Safari ITP) have IndexedDB
// present but non-functional there, which corrupts the stored auth token
// and makes getIdToken() throw a cryptic "The string did not match the
// expected pattern." error instead of returning a token — see
// src/services/groq.js's callGroq for where that used to leak to users.
// initializeAuth's persistence array makes the SDK fall back through
// working mechanisms instead of only ever trying IndexedDB.
// initializeAuth throws if auth was already set up on this app (e.g. Vite
// HMR re-running this module) — getAuth() just returns the existing one.
let auth;
try {
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence],
  });
} catch {
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);
