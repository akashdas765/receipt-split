import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Landmark, Plus, TrendingUp, Search } from 'lucide-react';

const INDIGO = '#6366f1';
const INACTIVE = '#94a3b8';

const SIDE_TABS = [
  { path: '/',           icon: Home,       label: 'Home' },
  { path: '/statements', icon: Landmark,   label: 'Statements' },
  { path: '/insights',   icon: TrendingUp, label: 'Insights' },
  { path: '/search',     icon: Search,     label: 'Search' },
];

// Persistent tab bar for the app's 3 main sections, with Scan as a raised
// center action (create-new, not a "you are here" tab) — shown on Home,
// Statements, and Insights, not on the scan/detail/approve flow pages,
// where a tab bar would compete with that flow's own primary action.
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 glass-footer"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-2xl mx-auto px-4 h-16 grid grid-cols-5 items-center relative">
        <TabButton {...SIDE_TABS[0]} active={pathname === SIDE_TABS[0].path} onClick={() => navigate(SIDE_TABS[0].path)} />
        <TabButton {...SIDE_TABS[1]} active={pathname === SIDE_TABS[1].path} onClick={() => navigate(SIDE_TABS[1].path)} />

        {/* Spacer under the raised Scan button */}
        <div />

        <TabButton {...SIDE_TABS[2]} active={pathname === SIDE_TABS[2].path} onClick={() => navigate(SIDE_TABS[2].path)} />
        <TabButton {...SIDE_TABS[3]} active={pathname === SIDE_TABS[3].path} onClick={() => navigate(SIDE_TABS[3].path)} />

        {/* Not btn-press: that class sets a literal `transform:
            translateY(...)` on hover/active, which replaces (rather than
            composes with) this button's own -translate-x-1/2 centering
            transform and made it visibly jump sideways. Tailwind's own
            translate/scale utilities compose correctly with each other via
            shared CSS variables, so hover/active states are done with those
            instead. */}
        <button
          onClick={() => navigate('/scan')}
          className="absolute left-1/2 -translate-x-1/2 -top-6 w-14 h-14 rounded-full flex items-center justify-center text-white btn-gradient transition-transform duration-150 hover:-translate-y-px active:scale-95"
          title="Scan Receipt"
        >
          <Plus size={26} />
        </button>
      </div>
    </nav>
  );
}

function TabButton({ icon: Icon, label, active, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5 h-full">
      <Icon size={20} style={{ color: active ? INDIGO : INACTIVE }} />
      <span className="text-[10px] font-bold" style={{ color: active ? INDIGO : INACTIVE }}>{label}</span>
    </button>
  );
}
