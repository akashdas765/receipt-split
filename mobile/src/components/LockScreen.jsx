import React, { useState, useEffect, useRef } from 'react';
import { ScanFace, LogOut } from 'lucide-react';
import { unlock, disable } from '../services/biometricLock';
import { logout } from '../services/auth';

// Full-screen gate shown instead of the router when the biometric lock is
// armed (see App.jsx) — nothing renders underneath, so no data flashes
// before Face ID passes. One automatic unlock attempt fires on mount
// (works in most contexts); the button is the required fallback for iOS
// Safari / the installed PWA, where credentials.get outside a user
// gesture can be rejected.
export default function LockScreen({ uid, onUnlocked }) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy]     = useState(false);
  const attemptedRef = useRef(false);

  const tryUnlock = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await unlock(uid);
      onUnlocked();
    } catch {
      // Cancelled, or the passkey was deleted at the OS level
      // (NotAllowedError either way — WebAuthn deliberately doesn't say
      // which). Show retry + the logout escape hatch below.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (attemptedRef.current) return; // one auto-attempt, never a loop
    attemptedRef.current = true;
    tryUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape hatch for a device whose credential is gone (OS passkey
  // deleted, biometrics re-enrolled): clearing the flag BEFORE logout
  // means the next password login isn't immediately locked behind a
  // prompt that can never succeed.
  const handleLogout = async () => {
    disable(uid);
    await logout();
  };

  return (
    <div className="min-h-screen aurora-bg flex flex-col items-center justify-center px-6 gap-6">
      <div className="w-14 h-14 rounded-2xl logo-glow anim-float flex items-center justify-center">
        <ScanFace size={28} className="text-white" />
      </div>
      <div className="text-center">
        <p className="font-extrabold text-ink text-lg">Truespend is locked</p>
        <p className="text-sm text-subtle mt-1">
          {failed ? "Couldn't verify — try again" : 'Unlock with Face ID or Touch ID'}
        </p>
      </div>
      <button
        onClick={tryUnlock}
        disabled={busy}
        className="w-full max-w-xs flex items-center justify-center gap-2 py-3 rounded-xl text-white font-bold text-sm btn-gradient btn-press disabled:opacity-60"
      >
        <ScanFace size={16} /> {busy ? 'Waiting…' : 'Unlock'}
      </button>
      <button
        onClick={handleLogout}
        className="flex items-center gap-1.5 text-xs font-semibold text-subtle hover:text-muted transition-colors"
      >
        <LogOut size={12} /> Log out and use password
      </button>
    </div>
  );
}
