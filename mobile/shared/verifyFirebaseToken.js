import { createRemoteJWKSet, jwtVerify } from 'jose';

// Verifies a Firebase Auth ID token by checking its signature against
// Google's public JWKS and validating the standard claims — no service
// account or firebase-admin needed.
//
// firebase-admin was tried first but doesn't bundle cleanly through
// Vercel's serverless function builder: it worked fine in `vercel dev`
// locally (runs directly against node_modules, no bundling step) but
// crashed the actual deployed function with FUNCTION_INVOCATION_FAILED
// before our own code even ran. jose is a small, dependency-free JWT
// library built for exactly this kind of edge/serverless environment.
const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// Returns the decoded token payload (with `sub` as the uid) if idToken is a
// valid, current Firebase Auth ID token for this project, or null otherwise.
export async function verifyFirebaseToken(idToken) {
  if (!idToken || !projectId) return null;
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer:   `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    return payload.sub ? payload : null;
  } catch {
    return null;
  }
}
