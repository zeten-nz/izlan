/* Pre-hydration theme bootstrap: sets the `.dark` class before first paint to avoid a flash.
   Constant, self-authored, no untrusted input. Loaded via next/script strategy=beforeInteractive. */
(function () {
  try {
    var p = localStorage.getItem('izl-theme');
    var dark = p === 'dark' || ((!p || p === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var r = document.documentElement;
    r.classList.toggle('dark', dark);
    r.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    /* storage/matchMedia unavailable — fall back to light */
  }
})();
