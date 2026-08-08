import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Receipt } from 'lucide-react';

// Shared header for every non-Home page — back button, the same
// ReceiptSplit mark HomePage shows, the page title, and an optional
// right-side action (children). Keeping the brand mark here too is what
// gives the app symmetry: without it, navigating away from Home dropped
// the logo and every other page felt like a bare utility screen.
//
// onBack defaults to browser-back (navigate(-1)); pass a function to send
// a page back to a specific route instead (several pages always want '/'
// regardless of how they were reached).
export default function PageHeader({ title, onBack, children }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-20 glass">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
        <button
          onClick={() => (onBack ? onBack() : navigate(-1))}
          className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-600 btn-press shrink-0"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center logo-glow shrink-0">
          <Receipt size={15} color="#fff" />
        </div>
        <span className="font-extrabold text-slate-800 flex-1 truncate">{title}</span>
        {children}
      </div>
    </header>
  );
}
