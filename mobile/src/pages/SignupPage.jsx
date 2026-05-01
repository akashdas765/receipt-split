import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Receipt, Mail, Lock, Key, AlertCircle } from 'lucide-react';
import { signup } from '../services/auth';

function Field({ label, hint, icon: Icon, type, value, onChange, placeholder, autoComplete, right }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-2">{hint}</p>}
      <div className="flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-3 focus-within:border-indigo transition-colors">
        <Icon size={16} className="text-slate-400 shrink-0" />
        <input
          type={type} value={value} onChange={onChange}
          placeholder={placeholder} autoComplete={autoComplete}
          className="flex-1 text-sm text-slate-800 bg-transparent outline-none placeholder-slate-300"
        />
        {right}
      </div>
    </div>
  );
}

export default function SignupPage() {
  const navigate = useNavigate();
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [confirm, setConfirm] = useState('');
  const [swKey,   setSwKey]   = useState('');
  const [showPw,  setShowPw]  = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const clear = setter => e => { setter(e.target.value); setError(''); };

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !pass || !confirm || !swKey.trim()) { setError('Please fill in all fields.'); return; }
    if (pass !== confirm) { setError('Passwords do not match.'); return; }
    if (pass.length < 6)  { setError('Password must be at least 6 characters.'); return; }
    setError(''); setLoading(true);
    try {
      await signup(email.trim(), pass, swKey.trim());
    } catch (err) {
      setError(err.message || 'Could not create account.');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (setter) => <button type="button" onClick={() => setter(v => !v)} className="text-slate-400 hover:text-slate-600 shrink-0" />;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'var(--indigo)', boxShadow: '0 8px 24px rgba(99,102,241,0.35)' }}>
            <Receipt size={32} color="#fff" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-800">ReceiptSplit</h1>
          <p className="text-sm text-slate-400 mt-1">Create your account</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <Field label="Email" icon={Mail} type="email" value={email} onChange={clear(setEmail)}
            placeholder="you@example.com" autoComplete="email" />

          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Password</label>
            <div className="flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-3 focus-within:border-indigo transition-colors">
              <Lock size={16} className="text-slate-400 shrink-0" />
              <input type={showPw ? 'text' : 'password'} value={pass} onChange={clear(setPass)}
                placeholder="Min 6 characters"
                className="flex-1 text-sm text-slate-800 bg-transparent outline-none placeholder-slate-300" />
              <button type="button" onClick={() => setShowPw(v => !v)} className="text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Confirm Password</label>
            <div className="flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-3 focus-within:border-indigo transition-colors">
              <Lock size={16} className="text-slate-400 shrink-0" />
              <input type={showPw ? 'text' : 'password'} value={confirm} onChange={clear(setConfirm)}
                placeholder="Re-enter password"
                className="flex-1 text-sm text-slate-800 bg-transparent outline-none placeholder-slate-300" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Splitwise API Key</label>
            <p className="text-xs text-slate-400 mb-2">splitwise.com → Account → Your apps → Register your application</p>
            <div className="flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-3 focus-within:border-indigo transition-colors">
              <Key size={16} className="text-slate-400 shrink-0" />
              <input type={showKey ? 'text' : 'password'} value={swKey} onChange={clear(setSwKey)}
                placeholder="Paste your API key" autoCapitalize="none" autoCorrect="off"
                className="flex-1 text-sm text-slate-800 bg-transparent outline-none placeholder-slate-300" />
              <button type="button" onClick={() => setShowKey(v => !v)} className="text-slate-400 hover:text-slate-600">
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-4">
              <AlertCircle size={15} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600 font-medium">{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-white font-bold text-sm transition-opacity disabled:opacity-60"
            style={{ background: 'var(--indigo)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-5">
          Already have an account?{' '}
          <button onClick={() => navigate('/login')} className="font-bold" style={{ color: 'var(--indigo)' }}>
            Sign In
          </button>
        </p>
      </div>
    </div>
  );
}
