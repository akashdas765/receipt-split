import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthChange } from './services/auth';
import { db } from './services/firebase';
import { session } from './services/session';
import { migrateLegacyPlaidConnection, loadPlaidConnections, loadSourceMeta } from './services/db';
import { isEnabled as isBiometricLockEnabled } from './services/biometricLock';
import LockScreen from './components/LockScreen';
import LoginPage   from './pages/LoginPage';
import SignupPage  from './pages/SignupPage';
import HomePage    from './pages/HomePage';
import ScanPage    from './pages/ScanPage';
import DetailPage  from './pages/DetailPage';
import ApprovePage from './pages/ApprovePage';
import InsightsPage from './pages/InsightsPage';
import StatementsPage from './pages/StatementsPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen aurora-bg">
      <div className="w-14 h-14 rounded-2xl logo-glow anim-float flex items-center justify-center">
        <div className="w-7 h-7 rounded-full border-[3px] border-white/30 border-t-white animate-spin" />
      </div>
    </div>
  );
}

export default function App() {
  const [user,     setUser]     = useState(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [locked,   setLocked]   = useState(false);
  // Only the FIRST auth event can arm the lock — that's the cold-start
  // session restore, the moment the app opens into someone's hands. Later
  // events are fresh password logins (the tree swaps from /login), and
  // demanding Face ID seconds after the user typed their password would
  // be pure friction. Cold-start-only also covers reopening the installed
  // PWA (iOS kills the process, so reopening IS a cold start); a
  // visibilitychange + idle-timeout re-lock is the natural follow-up if
  // backgrounding-without-kill turns out to matter.
  const firstAuthEventRef = useRef(true);

  useEffect(() => {
    return onAuthChange(async (firebaseUser) => {
      const firstEvent = firstAuthEventRef.current;
      firstAuthEventRef.current = false;
      if (firebaseUser) {
        if (firstEvent && isBiometricLockEnabled(firebaseUser.uid)) setLocked(true);
        session.setUserId(firebaseUser.uid);
        if (!session.getKey()) {
          try {
            const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
            if (snap.exists()) session.setKey(snap.data().splitwise_api_key);
          } catch {}
          // Split from the block below on purpose: a migration failure here
          // must not skip loading the connections that already exist post-
          // migration — they used to share one try/catch, so a thrown
          // migration silently left every Plaid connection unloaded for the
          // whole session with no trace (getAccountType/isBankAccountSource
          // would then wrongly return false for everything).
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
        }
        setUser(firebaseUser);
      } else {
        setUser(null);
      }
      setHydrated(true);
    });
  }, []);

  if (!hydrated) return <Spinner />;

  // Rendered INSTEAD of the router — no page mounts, no data flashes,
  // until the OS verification passes. Session/Plaid hydration above has
  // already run; the lock is purely visual gating.
  if (user && locked) return <LockScreen uid={user.uid} onUnlocked={() => setLocked(false)} />;

  return (
    <BrowserRouter>
      <Routes>
        {user ? (
          <>
            <Route path="/"        element={<HomePage />} />
            <Route path="/scan"    element={<ScanPage />} />
            <Route path="/detail"  element={<DetailPage />} />
            <Route path="/approve" element={<ApprovePage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/statements" element={<StatementsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*"        element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/login"  element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="*"       element={<Navigate to="/login" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
