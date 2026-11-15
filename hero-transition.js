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
  function ok() { return vt && !reduce.matches; }

  // OPEN: card → full-screen image viewer
  document.addEventListener('click', function (e) {
    var card = e.target.closest && e.target.closest('.prod-card[data-hero-id]');
    if (!card || !ok() || typeof card.onclick !== 'function') return;
    var img = card.querySelector('.prod-img'), id = card.dataset.heroId;
    if (!img || !id) return;
    e.stopImmediatePropagation();
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
    if (!document.body.contains(c.card)) return;        // list re-rendered: let the normal close run
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
})();
