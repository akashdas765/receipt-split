import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function adminApp() {
  // No service account needed — verifyIdToken only checks the JWT signature
  // against Google's public certs and validates standard claims (aud, exp,
  // etc.), which requires knowing the project id but no privileged credentials.
  return getApps().length ? getApps()[0] : initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID });
}

// Returns the decoded token (with `uid`) if idToken is a valid, current
// Firebase Auth ID token for this project, or null otherwise.
export async function verifyFirebaseToken(idToken) {
  if (!idToken) return null;
  try {
    return await getAuth(adminApp()).verifyIdToken(idToken);
  } catch {
    return null;
  }
}
