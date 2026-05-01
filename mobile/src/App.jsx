import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { onAuthChange } from './services/auth';
import { db } from './services/firebase';
import { session } from './services/session';
import LoginPage   from './pages/LoginPage';
import SignupPage  from './pages/SignupPage';
import HomePage    from './pages/HomePage';
import ScanPage    from './pages/ScanPage';
import DetailPage  from './pages/DetailPage';
import ApprovePage from './pages/ApprovePage';

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="w-10 h-10 rounded-full border-4 border-indigo-200 border-t-indigo animate-spin" />
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
