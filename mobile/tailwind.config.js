/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        indigo: { DEFAULT: '#6366f1', dark: '#4f46e5', light: '#e0e7ff' },
        emerald: { DEFAULT: '#10b981' },
        // Semantic aliases backed by CSS variables (see index.css's :root/
        // .dark blocks) — used in place of raw slate-* utilities so a
        // light/dark palette tweak is a CSS-variable change in one place
        // instead of a repeat of the class-rename sweep that introduced
        // these. Only covers the "ink scale" (body text/surfaces/borders);
        // semantic status colors (red/emerald/indigo) already work on both
        // backgrounds and are untouched.
        ink:         'var(--c-ink)',
        muted:       'var(--c-muted)',
        subtle:      'var(--c-subtle)',
        surface:     'var(--c-surface)',
        'surface-alt': 'var(--c-surface-alt)',
        edge:        'var(--c-edge)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
