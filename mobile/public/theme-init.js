// Runs before first paint (loaded via a blocking <script src> in index.html,
// no defer/async) to set the `dark` class before React ever mounts — avoids
// a flash of the wrong theme on load. Must stay in exact sync with
// ThemeProvider.jsx's getInitialTheme() (same localStorage key, same
// fallback logic) or the two can disagree and reintroduce the flash.
//
// External file, not an inline <script>, because vercel.json/netlify.toml's
// CSP is `script-src 'self'` with no 'unsafe-inline' — an inline script here
// would be silently blocked in production.
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
