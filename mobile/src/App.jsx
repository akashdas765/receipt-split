import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Box, CircularProgress } from '@mui/material';
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
import SettingsPage from './pages/SettingsPage';

function Spinner() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh' }}>
      <CircularProgress />
    </Box>
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
      <AnimatedRoutes user={user} />
    </BrowserRouter>
  );
}

// Every page remounts fresh on navigation already (different route ->
// different component); keying this wrapper on pathname just gives that
// fresh mount a moment of motion (the `pageFadeIn` keyframe defined in
// theme.js's MuiCssBaseline overrides) instead of an instant, jarring swap.
function AnimatedRoutes({ user }) {
  const location = useLocation();
  return (
    <Box key={location.pathname} sx={{ animation: 'pageFadeIn 220ms ease' }}>
      <Routes location={location}>
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
    </Box>
  );
}
