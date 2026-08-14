import React from 'react';
import { X, Receipt, CheckCheck, Landmark, Bell } from 'lucide-react';

const INDIGO = '#6366f1';

const ICONS = {
  receipt_parsed: Receipt,
  receipt_posted: CheckCheck,
  bank_linked:    Landmark,
};

// Same relative-time shorthand a notification list needs ("2h ago", "1d
// ago") — falls back to a plain date past a week, since "23d ago" reads
// worse than "Jul 21" at that distance.
function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Every notification here is a real, persisted event (see db.js's
// logNotification and its call sites in ScanPage/ApprovePage/PlaidConnect)
// — not synthesized from current app state, so this list only ever grows
// when something has actually happened. onSelect marks the tapped row read
// and, when the caller can act on it (a receipt to open, a page to jump
// to), does that too — HomePage owns what "acting on it" means per type.
export default function NotificationCenter({ notifications, onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 anim-fade-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-t-3xl max-h-[75vh] flex flex-col anim-sheet-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-alt" />
        </div>

        <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
          <p className="font-extrabold text-ink text-sm">Notifications</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-subtle hover:text-muted shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-2">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-14 h-14 rounded-2xl bg-surface-alt flex items-center justify-center mb-3">
                <Bell size={22} className="text-subtle" />
              </div>
              <p className="text-sm text-subtle">Nothing yet</p>
            </div>
          ) : (
            notifications.map(n => {
              const Icon = ICONS[n.type] || Bell;
              return (
                <button
                  key={n.id}
                  onClick={() => onSelect(n)}
                  className={`w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl border transition-colors ${n.read ? 'border-edge bg-surface' : 'border-indigo-100 bg-indigo-50/40 hover:bg-indigo-50'}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-surface-alt flex items-center justify-center shrink-0" style={{ color: INDIGO }}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink font-semibold leading-snug">{n.text}</p>
                    <p className="text-[11px] text-subtle mt-0.5">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.read && <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: INDIGO }} />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
