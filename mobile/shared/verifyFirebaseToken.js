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
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

// Returns the decoded token payload (with `sub` as the uid) if idToken is a
// valid, current Firebase Auth ID token for this project, or null otherwise.
export async function verifyFirebaseToken(idToken) {
  // Read at call time, not module load time: in local dev, vite.config.js's
  // dev-server middleware imports this module (transitively) before its own
  // config factory function runs, and that factory is where
  // process.env.VITE_FIREBASE_PROJECT_ID actually gets set — a module-level
  // `const` here would have permanently captured `undefined` from before
  // that assignment ever happened.
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!idToken || !projectId) return null;
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer:   `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    return payload.sub ? payload : null;
  } catch (err) {
    // Logged server-side only (never sent to the client) — the catch-all
    // here previously made every failure mode (bad signature, expired
    // token, clock skew, JWKS fetch blocked by network/firewall, wrong
    // project id) look identical from the outside, which made this class
    // of bug unnecessarily hard to diagnose.
    console.error('verifyFirebaseToken failed:', err?.code || err?.message || err);
    return null;
  }
}
