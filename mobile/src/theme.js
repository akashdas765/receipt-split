import { createTheme, alpha } from '@mui/material/styles';

// MUI's default palette generation only produces main/light/dark/
// contrastText for each color — it does NOT produce the numbered 50/100/200
// tint shades (that's a Tailwind/Material-static-palette convention, not
// something createTheme derives automatically). The app leans on
// `bgcolor: 'success.50'`-style tokens throughout (status badges, tinted
// banners, highlighted rows) — without this, those `sx` lookups silently
// resolve to nothing and the tint just never renders. In light mode these
// are real pastel tints (matching the original Tailwind palette); in dark
// mode they're low-alpha washes of the same hue over the dark surface, so a
// "tinted panel" still reads as that color, subtly, rather than being
// either invisible or blown out against a dark background.
function tonalShades(mode, hex, { l50, l100, l200 }) {
  if (mode === 'light') return { 50: l50, 100: l100, 200: l200 };
  return { 50: alpha(hex, 0.14), 100: alpha(hex, 0.22), 200: alpha(hex, 0.32) };
}

// Same brand colors the old Tailwind/CSS-variable system used (index.css's
// --indigo/--emerald) — kept during the MUI rebuild so the app doesn't also
// change its color identity mid-migration, just its component library.
export function createAppTheme(mode) {
  const primaryMain = '#6366f1';
  const successMain = '#10b981';
  const warningMain = '#f59e0b';
  const errorMain   = '#ef4444';
  const infoMain    = '#0ea5e9';
  const isDark = mode === 'dark';

  const theme = createTheme({
    palette: {
      mode,
      primary: {
        main: primaryMain, dark: '#4f46e5', light: '#818cf8',
        ...tonalShades(mode, primaryMain, { l50: '#eef2ff', l100: '#e0e7ff', l200: '#c7d2fe' }),
      },
      success: {
        main: successMain, dark: '#059669', light: '#34d399',
        ...tonalShades(mode, successMain, { l50: '#ecfdf5', l100: '#d1fae5', l200: '#a7f3d0' }),
      },
      warning: {
        main: warningMain, dark: '#d97706', light: '#fbbf24',
        ...tonalShades(mode, warningMain, { l50: '#fffbeb', l100: '#fef3c7', l200: '#fde68a' }),
      },
      error: {
        main: errorMain, dark: '#dc2626', light: '#f87171',
        ...tonalShades(mode, errorMain, { l50: '#fef2f2', l100: '#fee2e2', l200: '#fecaca' }),
      },
      info: {
        main: infoMain, dark: '#0284c7', light: '#38bdf8',
        ...tonalShades(mode, infoMain, { l50: '#f0f9ff', l100: '#e0f2fe', l200: '#bae6fd' }),
      },
      background: {
        default: isDark ? '#0f172a' : '#f1f4fb',
        paper: isDark ? '#1e293b' : '#ffffff',
      },
      divider: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.08)',
    },
    typography: {
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      // Space Grotesk on every heading variant + a dedicated `numeric`
      // variant (see below) — this is what actually reads as "personality"
      // rather than generic SaaS, especially on the big headline dollar
      // figures (net worth hero tile, spend totals). Kept OFF body/caption
      // — its wider letterforms cost real density on the small, tightly-
      // packed meta lines (dates, categories) throughout the app.
      h1: { fontFamily: "'Space Grotesk', sans-serif" },
      h2: { fontFamily: "'Space Grotesk', sans-serif" },
      h3: { fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.02em' },
      h4: { fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.01em' },
      h5: { fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.01em' },
      h6: { fontFamily: "'Space Grotesk', sans-serif" },
      button: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 },
    },
    shape: { borderRadius: 12 },
    // Softer, more tightly-graded elevation than MUI's stock shadow ramp
    // (which jumps to a heavy, dark drop-shadow almost immediately) — every
    // clickable Paper row in this app lives at elevation 0-3, so that's the
    // range worth actually shaping; higher indices fall back to the last
    // custom entry rather than trailing off into unused values.
    shadows: [
      'none',
      isDark ? '0 1px 2px rgba(0,0,0,0.4)' : '0 1px 2px rgba(15,23,42,0.04)',
      isDark ? '0 2px 6px rgba(0,0,0,0.4)' : '0 2px 6px rgba(15,23,42,0.05)',
      isDark ? '0 4px 12px rgba(0,0,0,0.45)' : '0 4px 12px rgba(15,23,42,0.07)',
      isDark ? '0 8px 20px rgba(0,0,0,0.5)' : '0 8px 20px rgba(15,23,42,0.09)',
      ...Array(20).fill(isDark ? '0 8px 20px rgba(0,0,0,0.5)' : '0 8px 20px rgba(15,23,42,0.09)'),
    ],
  });

  theme.components = {
    MuiCssBaseline: {
      styleOverrides: {
        '@keyframes pageFadeIn': {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        '@keyframes rowFadeIn': {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        button: {
          transition: 'transform 120ms ease, box-shadow 150ms ease, background-color 150ms ease, border-color 150ms ease, opacity 150ms ease',
        },
        'button:active': { transform: 'scale(0.97)' },
        // Suppresses the browser's own default crossfade on the root view
        // transition snapshots — ThemeProvider.jsx drives a custom circular
        // clip-path reveal on ::view-transition-new(root) instead (see its
        // own comment), and the two animating at once looks like a
        // stutter/double-fade rather than one clean reveal.
        '::view-transition-old(root), ::view-transition-new(root)': {
          animation: 'none',
          mixBlendMode: 'normal',
        },
        // The soft indigo/violet/emerald "aurora" wash every page used to
        // sit on (old index.css's .aurora-bg, applied per-page) got dropped
        // during the MUI rebuild — pages just fell back to a flat, nearly-
        // white background.default, which is the biggest single reason the
        // app reads as washed out now. Applied at the body level (not
        // background.default itself) so it shows through every page's root
        // Box, none of which set their own bgcolor — same effect as before,
        // one definition instead of one per page.
        body: {
          background: isDark
            ? 'radial-gradient(ellipse 80% 50% at 20% -10%, rgba(99,102,241,0.16), transparent),'
              + 'radial-gradient(ellipse 60% 40% at 90% 0%, rgba(139,92,246,0.12), transparent),'
              + 'radial-gradient(ellipse 50% 40% at 60% 100%, rgba(16,185,129,0.08), transparent),'
              + '#0f172a'
            : 'radial-gradient(ellipse 80% 50% at 20% -10%, rgba(99,102,241,0.16), transparent),'
              + 'radial-gradient(ellipse 60% 40% at 90% 0%, rgba(139,92,246,0.13), transparent),'
              + 'radial-gradient(ellipse 50% 40% at 60% 100%, rgba(16,185,129,0.08), transparent),'
              + '#f1f4fb',
          backgroundAttachment: 'fixed',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: ({ ownerState }) => ({
          // Every card in this app is `variant="outlined"` — MUI's own
          // definition of "outlined" is border-only, no shadow, which on
          // top of a pale background is what actually reads as "flat" —
          // giving it a resting shadow too (not just on hover/press below)
          // matches the shadow-sm treatment nearly every card had pre-MUI.
          ...(ownerState.variant === 'outlined' && {
            boxShadow: isDark ? '0 1px 3px rgba(0,0,0,0.35)' : '0 1px 3px rgba(15,23,42,0.06)',
          }),
          // Only Paper rendered `component="button"` (every tappable list
          // row/card throughout the app) gets the interactive treatment —
          // ownerState carries the resolved `component` prop, so a plain
          // structural Paper (a sheet's body, a static card) doesn't.
          ...(ownerState.component === 'button' && {
            cursor: 'pointer',
            transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
            '&:hover': {
              boxShadow: isDark ? '0 6px 16px rgba(0,0,0,0.45)' : '0 6px 16px rgba(15,23,42,0.1)',
              transform: 'translateY(-1px)',
            },
            '&:active': { transform: 'translateY(0) scale(0.985)' },
          }),
        }),
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 700 },
        contained: {
          '&:hover': { boxShadow: isDark ? '0 6px 16px rgba(0,0,0,0.45)' : '0 6px 16px rgba(99,102,241,0.25)' },
        },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: {
          transition: 'transform 150ms ease, box-shadow 150ms ease',
          '&:hover': { transform: 'scale(1.05)' },
          '&:active': { transform: 'scale(0.95)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600 } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
    },
  };

  return theme;
}
