// Thin wrappers around browser PWA/notification APIs, same layering as
// services/plaid.js/services/splitwise.js wrapping their respective SDKs.

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err));
  });
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

const LAST_REMINDER_KEY = 'pendingReceiptReminder.lastFiredAt';

// Fires at most once per calendar day when there are pending receipts and
// permission is granted — no push infra, no backend, just the Notification
// API used directly. Scoped to whatever the caller passes in (HomePage's
// currently-selected month, matching what's already visibly shown as the
// "+$X pending" line — not "all pending receipts ever").
export function maybeShowPendingReminder(pendingCount, pendingTotal) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!pendingCount) return;
  const last = localStorage.getItem(LAST_REMINDER_KEY);
  const today = new Date().toISOString().slice(0, 10);
  if (last === today) return;
  new Notification('ReceiptSplit', {
    body: `You have ${pendingCount} pending receipt${pendingCount !== 1 ? 's' : ''} ($${pendingTotal.toFixed(2)}) not yet split.`,
    icon: '/favicon-32.png',
    tag: 'pending-receipts',
  });
  localStorage.setItem(LAST_REMINDER_KEY, today);
}
