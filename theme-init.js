/* =============================================================================
   SynthWorks — theme-init.js

   Loaded SYNCHRONOUSLY in <head> before any stylesheet paints. Its only job is
   to stamp data-theme on <html> so the correct palette is applied on the very
   first frame — without this there is a white flash before the dark theme
   loads (or vice versa).

   Kept as a separate file rather than an inline <script> so the codebase holds
   to its "no inline JavaScript" rule.
   ========================================================================== */

(function bootstrapTheme() {
  var KEY = 'synthworks:theme';
  var theme;

  try {
    var saved = window.localStorage.getItem(KEY);
    if (saved) theme = JSON.parse(saved);
  } catch (err) {
    // Private mode / storage disabled — fall through to the system preference.
  }

  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  document.documentElement.setAttribute('data-theme', theme);

  // Keep the mobile browser chrome in step with the palette.
  document.addEventListener('DOMContentLoaded', function syncMeta() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0a0f' : '#fbfbfc');
  });
}());
