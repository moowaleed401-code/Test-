/* scroll-fx.js — one global scroll fade/reveal + hide-on-scroll sub-header for the public kiosk.
   Loaded once from index.html (classic script, CSP-safe: no inline code, no dependencies).

   • Elements fade a little and drift up ~10px as they LEAVE the top of the screen, and come back when you scroll
     up. It is driven by each element's position (not a one-off trigger), so it is continuous and fully reversible.
   • Uses `filter:opacity()` + the individual `translate` property on purpose: the cards already run a CSS `cardIn`
     animation (fill-mode: both) and the hero content has an inline `transform`, which would override or fight
     opacity/transform. These two properties are untouched by them, and are GPU-composited (no layout, no shifts).
   • Opt in/out per element:  data-fx / data-fx-ignore.   Add new selectors to TARGETS.  */
(function () {
  'use strict';
  if (window.__scrollFx) return; window.__scrollFx = true;

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) return;                     // content stays fully visible, nothing is hidden

  var TARGETS = '#page-menu .menu-hero-content, #page-menu .cat-card, #page-menu .prod-card, #page-menu .gallery-item,' +
                '#page-menu .inner-banner-wrap, #page-menu .section-gallery-intro, #page-menu [data-fx]';
  var NEVER   = '#view-product, #adminOverlay, #kioskStartOverlay, .kiosk-top-bar, .inner-header, .section-tabs-bar,' +
                '.gallery-back-btn, .gallery-view-label, .scroll-more-indicator, form, dialog, [role="dialog"],' +
                '[role="menu"], [aria-modal="true"], [data-fx-ignore]';
  var MIN_OPACITY = 0.2;                           // never fully invisible

  var st = document.createElement('style');
  st.textContent =
    '[data-fx-on]{filter:opacity(var(--fx-o,1));translate:0 var(--fx-y,0px)}' +
    '.inner-header,.section-tabs-bar{transition:transform .35s cubic-bezier(.22,.61,.36,1)}' +
    '.fx-hdr-hidden #view-inner.active .inner-header{transform:translateY(-100%)}' +
    '.fx-hdr-hidden #view-inner.active .section-tabs-bar{transform:translateY(calc(var(--fx-hh,66px) * -1))}';
  document.head.appendChild(st);

  var tracked = new Set(), seen = new WeakSet(), ticking = false;
  function clear(el) { el.style.removeProperty('--fx-o'); el.style.removeProperty('--fx-y'); }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) tracked.add(e.target);
      else {
        tracked.delete(e.target);
        if (e.boundingClientRect.top < 0 && e.boundingClientRect.height) {   // scrolled off the top → stay faded
          e.target.style.setProperty('--fx-o', MIN_OPACITY); e.target.style.setProperty('--fx-y', '-12px');
        } else clear(e.target);
      }
    });
    schedule();
  }, { rootMargin: '15% 0px 15% 0px' });

  function add(el) {
    if (seen.has(el) || el.closest(NEVER)) return;
    var pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') return;
    seen.add(el); el.setAttribute('data-fx-on', ''); io.observe(el);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(TARGETS)) add(node);
    node.querySelectorAll(TARGETS).forEach(add);
  }

  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function frame() {
    ticking = false;
    var pd = root.classList.contains('pd-open');          // product page has its own scroll-linked header
    var zone = innerHeight * 0.3, shift = innerWidth < 640 ? 8 : 12;
    tracked.forEach(function (el) {
      if (pd || el.matches(':hover, :focus-within')) { clear(el); return; }   // never fade what is being touched/read
      var p = ease(Math.min(1, Math.max(0, (zone - el.getBoundingClientRect().bottom) / zone)));
      if (p) { el.style.setProperty('--fx-o', (1 - p * (1 - MIN_OPACITY)).toFixed(3)); el.style.setProperty('--fx-y', (-p * shift).toFixed(1) + 'px'); }
      else clear(el);
    });
    header(pd);
  }

  /* Sub-header (.inner-header): hides on scroll down, returns on scroll up; hysteresis avoids touch flicker.
     The sticky .section-tabs-bar below it slides up with it so there is no gap. */
  var lastY = scrollY, acc = 0;
  function header(pd) {
    var y = Math.max(0, scrollY), dy = y - lastY; lastY = y;
    acc = (dy && Math.sign(dy) === Math.sign(acc)) ? acc + dy : dy;
    var h = document.querySelector('#view-inner.active .inner-header');
    if (!h || pd) { root.classList.remove('fx-hdr-hidden'); return; }
    root.style.setProperty('--fx-hh', h.offsetHeight + 'px');
    if (y < 80 || h.matches(':focus-within')) root.classList.remove('fx-hdr-hidden');
    else if (acc > 28) root.classList.add('fx-hdr-hidden');
    else if (acc < -14) root.classList.remove('fx-hdr-hidden');
  }

  function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });

  // Cards/products/gallery are rendered by kiosk-app.js after Firestore loads, and views switch without page loads.
  var mo = new MutationObserver(function (muts) { muts.forEach(function (m) { m.addedNodes.forEach(scan); }); schedule(); });
  var host = document.getElementById('page-menu') || document.body;
  mo.observe(host, { childList: true, subtree: true });
  scan(host);

  reduce.addEventListener && reduce.addEventListener('change', function () {
    if (!reduce.matches) return;
    io.disconnect(); mo.disconnect(); removeEventListener('scroll', schedule); removeEventListener('resize', schedule);
    tracked.forEach(clear); root.classList.remove('fx-hdr-hidden');
  });
})();
