import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Receipt, Mail, Lock, AlertCircle } from 'lucide-react';
import { login } from '../services/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !pass) { setError('Please enter your email and password.'); return; }
    setError(''); setLoading(true);
    try {
      await login(email.trim(), pass);
    } catch (err) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
            style={{ background: 'var(--indigo)', boxShadow: '0 8px 24px rgba(99,102,241,0.35)' }}>
            <Receipt size={32} color="#fff" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800">ReceiptSplit</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to your account</p>
        </div>

        {/* Card */}
        <form onSubmit={submit} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Email</label>
            <div className="flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-3 focus-within:border-indigo transition-colors">
              <Mail size={16} className="text-slate-400 shrink-0" />
              <input
                type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
                placeholder="you@example.com" autoComplete="email"
                className="flex-1 text-sm text-slate-800 bg-transparent outline-none placeholder-slate-300"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Password</label>
            <div className="flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-3 focus-within:border-indigo transition-colors">
              <Lock size={16} className="text-slate-400 shrink-0" />
              <input
                type={showPw ? 'text' : 'password'} value={pass}
                onChange={e => { setPass(e.target.value); setError(''); }}
                placeholder="••••••••" autoComplete="current-password"
                className="flex-1 text-sm text-slate-800 bg-transparent outline-none placeholder-slate-300"
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className="text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-4">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600 font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-white font-bold text-sm transition-opacity disabled:opacity-60"
            style={{ background: 'var(--indigo)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-5">
          Don't have an account?{' '}
          <button onClick={() => navigate('/signup')} className="font-bold" style={{ color: 'var(--indigo)' }}>
            Sign Up
          </button>
        </p>
      </div>
    </div>
  );
}
