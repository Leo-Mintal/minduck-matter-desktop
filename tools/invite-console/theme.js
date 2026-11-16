(function () {
  'use strict';
  let theme;
  try {
    theme = localStorage.getItem('matter:invite-console:theme');
  } catch {
    // Theme preference is optional, including when opened directly from disk.
  }
  document.documentElement.dataset.theme = theme === 'light' || theme === 'dark'
    ? theme
    : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
})();
