import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthChange } from './services/auth';
import { db } from './services/firebase';
import { session } from './services/session';
import { migrateLegacyPlaidConnection, loadPlaidConnections, loadSourceMeta } from './services/db';
import LoginPage   from './pages/LoginPage';
import SignupPage  from './pages/SignupPage';
import HomePage    from './pages/HomePage';
import ScanPage    from './pages/ScanPage';
import DetailPage  from './pages/DetailPage';
import ApprovePage from './pages/ApprovePage';
import InsightsPage from './pages/InsightsPage';
import StatementsPage from './pages/StatementsPage';
import SearchPage from './pages/SearchPage';

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

  useEffect(() => {
    return onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
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
