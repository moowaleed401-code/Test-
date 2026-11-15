/* hero-transition.js — shared-element (hero) navigation via the View Transitions API.
   The clicked card image and the viewer/detail image share ONE view-transition-name, derived from the
   product's stable id, and it exists on exactly one element at a time (never on every card in a list).
   Framer Motion layoutId is React-only; this project has no React, so the browser-native API is used.
   Falls back to the normal instant swap where the API is missing or reduced-motion is set. */
(function () {
  'use strict';
  var vt = document.startViewTransition ? document.startViewTransition.bind(document) : null;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var current = null; // { id, card }

  function nameFor(id) { return 'hero-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_'); }
  function setName(el, id) { if (el) { el.style.viewTransitionName = nameFor(id); el.style.viewTransitionClass = 'hero'; } }
  function clearName(el) { if (el) { el.style.viewTransitionName = ''; el.style.viewTransitionClass = ''; } }
  function radii(from, to) {
    var r = document.documentElement.style;
    r.setProperty('--hero-r-from', from || '0px'); r.setProperty('--hero-r-to', to || '0px');
  }
  function rad(el) { return el ? getComputedStyle(el).borderTopLeftRadius : '0px'; }
  function ok() { return vt && !reduce.matches; }

  // OPEN: card → full-screen image viewer
  document.addEventListener('click', function (e) {
    var card = e.target.closest && e.target.closest('.prod-card[data-hero-id]');
    if (!card || !ok() || typeof card.onclick !== 'function') return;
    var img = card.querySelector('.prod-img'), id = card.dataset.heroId;
    if (!img || !id) return;
    if (e.target.closest('button,a,input,[data-no-nav]')) return; // secondary actions stay independent
    e.stopImmediatePropagation();
    radii(rad(card), rad(document.getElementById('image-menu-photo')));
    setName(img, id);
    var t = vt(function () {
      clearName(img);                                   // old snapshot is already captured
      setName(document.getElementById('image-menu-photo'), id);
      card.onclick(e);                                  // kiosk-app's own handler (openImageMenu)
    });
    current = { id: id, card: card };
    t.finished.finally(function () { clearName(document.getElementById('image-menu-photo')); });
  }, true);

  // CLOSE: viewer → the same card (reverse animation)
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-act="closeImageMenu"]');
    if (!btn || !current || !ok() || typeof window.closeImageMenu !== 'function') return;
    var viewer = document.getElementById('image-menu-photo'), c = current; current = null;
    if (!document.body.contains(c.card)) return;
    radii(rad(viewer), rad(c.card));        // list re-rendered: let the normal close run
    e.stopImmediatePropagation();
    setName(viewer, c.id);
    var t = vt(function () {
      clearName(viewer);
      window.closeImageMenu();
      var img = c.card.querySelector('.prod-img'); setName(img, c.id);
      c.card.scrollIntoView({ block: 'nearest' });
    });
    t.finished.finally(function () { clearName(c.card.querySelector('.prod-img')); });
  }, true);

  /* ── CATEGORIES: home card photo → category banner (and back). Names go on the image WRAPPERS
     (the banner <img> fades in only after it loads, the wrapper is always there). ── */
  var curCat = null, redispatch = false;

  document.addEventListener('click', function (e) {
    if (redispatch || !ok()) return;
    var card = e.target.closest && e.target.closest('.cat-card[data-hero-id]');
    if (!card) return;
    var wrap = card.querySelector('.cat-img-wrap'), id = card.dataset.heroId;
    if (!wrap || !id) return;
    e.stopImmediatePropagation();
    var inner = document.getElementById('view-inner'), banner = inner && inner.querySelector('.inner-banner-wrap');
    radii(rad(card), rad(banner));
    setName(wrap, id);
    var dest = null;
    var t = vt(function () {
      clearName(wrap);
      redispatch = true;                                 // let kiosk-app's own grid handler run
      try { card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } finally { redispatch = false; }
      var b = inner && inner.classList.contains('active') && inner.querySelector('.inner-banner-wrap');
      if (b && b.offsetParent) { dest = b; setName(b, id); curCat = { id: id, card: card }; }  // gallery/offers modes hide the banner → plain fade
    });
    t.finished.finally(function () { clearName(dest); clearName(wrap); });
  }, true);

  document.addEventListener('click', function (e) {
    if (redispatch || !curCat || !ok() || typeof window.goHome !== 'function') return;
    var btn = e.target.closest && e.target.closest('[data-act="goHome"]');
    var inner = document.getElementById('view-inner');
    if (!btn || !inner || !inner.classList.contains('active')) return;
    var c = curCat, banner = inner.querySelector('.inner-banner-wrap'); curCat = null;
    if (!banner || !banner.offsetParent || !document.body.contains(c.card)) return;
    e.stopImmediatePropagation();
    radii(rad(banner), rad(c.card));
    setName(banner, c.id);
    var t = vt(function () {
      clearName(banner);
      window.goHome();
      var w = c.card.querySelector('.cat-img-wrap'); setName(w, c.id);
      c.card.scrollIntoView({ block: 'nearest' });
    });
    t.finished.finally(function () { clearName(banner); clearName(c.card.querySelector('.cat-img-wrap')); });
  }, true);
})();
