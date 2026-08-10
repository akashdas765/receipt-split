import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Key, Mail, Lock, LogOut, Moon, Sun, Bell, BellOff } from 'lucide-react';
import { auth } from '../services/firebase';
import { logout, changePassword } from '../services/auth';
import { updateSplitwiseKey } from '../services/db';
import { session } from '../services/session';
import { requestNotificationPermission } from '../services/pwa';
import { useToast } from '../components/ToastProvider';
import { useTheme } from '../components/ThemeProvider';
import PageHeader from '../components/PageHeader';

const initialNotifPermission = () => ('Notification' in window ? Notification.permission : 'unsupported');

function Section({ title, children }) {
  return (
    <div className="bg-surface rounded-2xl border border-edge p-4">
      <h2 className="text-xs font-bold text-muted uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { theme, toggleTheme } = useTheme();

  const [apiKey,   setApiKey]   = useState(session.getKey() || '');
  const [revealed, setRevealed] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [notifPermission, setNotifPermission] = useState(initialNotifPermission);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw,      setNewPw]     = useState('');
  const [confirmPw,  setConfirmPw] = useState('');
  const [pwRevealed, setPwRevealed] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  const savedKey = session.getKey() || '';
  const dirty    = apiKey.trim() !== savedKey;

  const handleSaveKey = async () => {
    setSaving(true);
    try {
      await updateSplitwiseKey(apiKey.trim());
      toast.success('Splitwise API key updated');
    } catch (err) {
      toast.error(err?.message || 'Could not update API key');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPw || !newPw || !confirmPw) { toast.error('Fill in all three password fields'); return; }
    if (newPw.length < 6) { toast.error('New password must be at least 6 characters'); return; }
    if (newPw !== confirmPw) { toast.error('New passwords do not match'); return; }
    setChangingPw(true);
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      toast.success('Password changed');
    } catch (err) {
      const message = err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential'
        ? 'Current password is incorrect'
        : (err?.message || 'Could not change password');
      toast.error(message);
    } finally {
      setChangingPw(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
    if (result === 'granted') toast.success('Reminders enabled');
    else if (result === 'denied') toast.error('Notifications blocked — enable in your browser settings to receive reminders');
  };

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      <PageHeader title="Settings" onBack={() => navigate('/')} />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4">
        <Section title="Account">
          <div className="flex items-center gap-2 text-sm text-ink">
            <Mail size={15} className="text-subtle shrink-0" />
            <span className="truncate">{auth.currentUser?.email || '—'}</span>
          </div>
        </Section>

        <Section title="Splitwise API key">
          <div className="flex items-center gap-2 border-2 border-edge rounded-xl px-3 py-3 focus-within:border-indigo-300 transition-colors mb-3">
            <Key size={16} className="text-subtle shrink-0" />
            <input
              type={revealed ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Paste your Splitwise API key"
              className="flex-1 text-sm text-ink bg-transparent outline-none placeholder-slate-300"
            />
            <button type="button" onClick={() => setRevealed(r => !r)} className="text-subtle hover:text-muted shrink-0">
              {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={saving || !dirty || !apiKey.trim()}
            className="w-full py-2.5 rounded-xl font-bold text-sm text-white btn-gradient btn-press disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {saving ? 'Verifying…' : 'Save key'}
          </button>
        </Section>

        <Section title="Change password">
          <div className="flex items-center gap-2 border-2 border-edge rounded-xl px-3 py-3 focus-within:border-indigo-300 transition-colors mb-2">
            <Lock size={16} className="text-subtle shrink-0" />
            <input
              type={pwRevealed ? 'text' : 'password'}
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              className="flex-1 text-sm text-ink bg-transparent outline-none placeholder-slate-300"
            />
          </div>
          <div className="flex items-center gap-2 border-2 border-edge rounded-xl px-3 py-3 focus-within:border-indigo-300 transition-colors mb-2">
            <Lock size={16} className="text-subtle shrink-0" />
            <input
              type={pwRevealed ? 'text' : 'password'}
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="New password (min 6 characters)"
              autoComplete="new-password"
              className="flex-1 text-sm text-ink bg-transparent outline-none placeholder-slate-300"
            />
          </div>
          <div className="flex items-center gap-2 border-2 border-edge rounded-xl px-3 py-3 focus-within:border-indigo-300 transition-colors mb-3">
            <Lock size={16} className="text-subtle shrink-0" />
            <input
              type={pwRevealed ? 'text' : 'password'}
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              className="flex-1 text-sm text-ink bg-transparent outline-none placeholder-slate-300"
            />
            <button type="button" onClick={() => setPwRevealed(r => !r)} className="text-subtle hover:text-muted shrink-0">
              {pwRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            onClick={handleChangePassword}
            disabled={changingPw || !currentPw || !newPw || !confirmPw}
            className="w-full py-2.5 rounded-xl font-bold text-sm text-white btn-gradient btn-press disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {changingPw ? 'Changing…' : 'Change password'}
          </button>
        </Section>

        <Section title="Appearance">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between gap-2 text-sm font-semibold text-ink"
          >
            <span className="flex items-center gap-2">
              {theme === 'dark' ? <Moon size={16} className="text-indigo-400" /> : <Sun size={16} className="text-amber-500" />}
              Dark mode
            </span>
            <span
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${theme === 'dark' ? 'bg-indigo-500' : 'bg-surface-alt'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow transition-transform ${theme === 'dark' ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </span>
          </button>
        </Section>

        <Section title="Notifications">
          {notifPermission === 'granted' ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
              <Bell size={16} /> Reminders enabled for pending receipts
            </p>
          ) : notifPermission === 'denied' ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <BellOff size={16} className="text-subtle shrink-0" />
              Blocked — enable notifications for this site in your browser settings
            </p>
          ) : notifPermission === 'unsupported' ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <BellOff size={16} className="text-subtle shrink-0" /> Not supported in this browser
            </p>
          ) : (
            <button
              onClick={handleEnableNotifications}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-white btn-gradient btn-press"
            >
              <Bell size={16} /> Enable reminders for pending receipts
            </button>
          )}
        </Section>

        <button
          onClick={handleLogout}
          className="w-full py-2.5 rounded-xl font-bold text-sm text-red-500 bg-red-50 hover:bg-red-100 transition-colors btn-press flex items-center justify-center gap-2"
        >
          <LogOut size={16} /> Log out
        </button>
      </main>
    </div>
  );
}
