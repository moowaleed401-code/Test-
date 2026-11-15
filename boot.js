/* boot.js — runs synchronously (classic script) BEFORE the ES modules.
   Everything that used to be inline JS / inline onclick="" attributes lives here,
   so the Content-Security-Policy can forbid inline scripts entirely. */
(function () {
  'use strict';

  /* Clickjacking fallback (meta-CSP cannot carry frame-ancestors; the real fix is the
     X-Frame-Options / frame-ancestors response header in _headers / firebase.json). */
  try {
    if (window.top !== window.self) { document.documentElement.style.display = 'none'; window.top.location = window.self.location; }
  } catch (e) { document.documentElement.style.display = 'none'; }

  window.KIOSK_VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
  window.openAdminOverlay = function () {
    document.getElementById('adminOverlay').classList.add('show');
    document.querySelector('meta[name="viewport"]').setAttribute('content', window.KIOSK_VIEWPORT);
  };

  /* Hero image preload: the real URL only arrives after the Firestore round-trip, so remember it from the last visit
     and start downloading it immediately. No remembered URL → remove the empty preload (it only caused a console warning). */
  try {
    var u = localStorage.getItem('anwarHeroUrl') || '';
    if (/^https:\/\//.test(u)) {
      var pre = document.createElement('link');
      pre.rel = 'preload'; pre.as = 'image'; pre.href = u; pre.id = 'heroPreload';
      pre.setAttribute('fetchpriority', 'high');
      document.head.appendChild(pre);
    }
  } catch (e) {}

  /* Non-blocking Google Fonts: used to be <link media="print" onload="this.media='all'"> */
  var fonts = document.getElementById('fontsStylesheet');
  if (fonts) fonts.media = 'all';

  /* Delegated click actions replacing inline onclick="". Strict allow-list: an attribute
     can never make this call an arbitrary function. */
  var ALLOWED = ['startKiosk', 'goHome', 'closeImageMenu', 'navImageMenu', 'closeProduct', 'toggleProductFav'];
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var name = el.getAttribute('data-act');
    if (ALLOWED.indexOf(name) === -1) return;
    var fn = window[name];
    if (typeof fn !== 'function') return;
    var raw = el.getAttribute('data-arg');
    try { raw === null ? fn() : fn(Number(raw)); } catch (err) { console.error(err); }
  });
})();
