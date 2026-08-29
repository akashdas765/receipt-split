// Biometric app lock — Face ID / Touch ID via WebAuthn's platform
// authenticator. This is a device-level LOCK over an already-authenticated
// Firebase session, not a login method: nothing is verified server-side
// (the challenge is random bytes no one checks, the assertion is
// discarded), the ceremony exists purely to make the OS run its own
// user-verification prompt and tell us whether it passed. That's the
// right tool for "don't open my finances to whoever holds my phone" —
// full passwordless passkey login (server-verified, custom-token minting)
// is a deliberately separate, future feature.
//
// One localStorage flag per user (`biolock:<uid>`, flat key style matching
// 'theme'/PlaidConnect) holding the credential's rawId — per-device and
// per-origin by nature, which is exactly the wanted scope: enabling the
// lock on your phone's installed PWA doesn't lock your laptop, and the
// Vercel vs Netlify domains each keep their own credential (rp.id is
// omitted below, so each origin registers its own).

const keyFor = uid => `biolock:${uid}`;

const toBase64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = str => Uint8Array.from(
  atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)
);

// Platform authenticator = the device's own Face ID/Touch ID/PIN, as
// opposed to a roaming security key — the only kind that makes sense for
// an app lock.
export async function isSupported() {
  try {
    return !!window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isEnabled(uid) {
  return !!uid && !!localStorage.getItem(keyFor(uid));
}

// Registers a device credential and arms the lock. Throws (typically
// NotAllowedError) if the user cancels the OS prompt — callers leave the
// lock off in that case.
export async function enable(uid, email) {
  const cred = await navigator.credentials.create({
    publicKey: {
      // Random and unverified on purpose — see the module comment.
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      // rp.id omitted → defaults to this origin's domain, keeping each
      // deploy target's credentials separate.
      rp: { name: 'Truespend' },
      user: {
        id: new TextEncoder().encode(uid),
        name: email || 'Truespend user',
        displayName: email || 'Truespend user',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        // 'discouraged' keeps this out of the user's synced passkey list
        // (iCloud Keychain etc.) — it's a per-device lock, not an account
        // credential worth syncing.
        residentKey: 'discouraged',
        userVerification: 'required',
      },
      attestation: 'none',
      timeout: 60000,
    },
  });
  localStorage.setItem(keyFor(uid), toBase64url(cred.rawId));
}

// Runs the OS verification prompt against the stored credential. Resolves
// true on success; throws on cancel/failure (NotAllowedError also covers a
// credential the user deleted at the OS level — callers offer a logout
// escape hatch for that).
export async function unlock(uid) {
  const stored = localStorage.getItem(keyFor(uid));
  if (!stored) return true; // lock no longer armed — nothing to verify
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: fromBase64url(stored), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return true;
}

export function disable(uid) {
  if (uid) localStorage.removeItem(keyFor(uid));
}
