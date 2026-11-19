/* ═══ admin-rail.js ═══ */
/* admin-rail.js — progressive enhancement of the existing admin sidebar. No admin.js changes:
   admin.js still owns routing (.nav-item[data-view] click → render()); this adds icons, a11y,
   the gliding active pill, and the tap-to-open drawer. */
(function () {
  'use strict';
  var ICONS = {
    overview:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    categories:'<path d="M4 6h16M4 12h16M4 18h10"/>',
    products:'<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>',
    offers:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    westernGallery:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
    media:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>',
    siteSettings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    logout:'<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'
  };
  function svg(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[k] || '') + '</svg>'; }

  function init() {
    var side = document.querySelector('#adminOverlay #appRoot > .sidebar');
    if (!side || side.classList.contains('rail')) return;
    side.classList.add('rail');
    side.setAttribute('aria-label', 'التنقل الرئيسي');
    var nav = side.querySelector('.nav-scroll');
    var items = Array.prototype.slice.call(side.querySelectorAll('.nav-item[data-view]'));
    var logout = side.querySelector('#logoutBtn');

    items.forEach(function (b) {
      var label = (b.querySelector('.nav-label') || b).textContent.trim();
      b.setAttribute('aria-label', label); b.title = label;           // icon-only state stays labelled
      var ic = b.querySelector('.ic'); if (ic) ic.innerHTML = svg(b.dataset.view);
    });
    if (logout) { var t = logout.textContent.replace('↪', '').trim(); logout.setAttribute('aria-label', t); logout.title = t; var li = logout.querySelector('.ic'); if (li) li.innerHTML = svg('logout'); }

    var pill = document.createElement('span'); pill.className = 'rail-pill'; pill.setAttribute('aria-hidden', 'true'); nav.prepend(pill);
    var back = document.createElement('div'); back.className = 'rail-backdrop'; document.getElementById('adminOverlay').appendChild(back);

    var phone = window.matchMedia('(max-width:650px)'), hoverless = window.matchMedia('(hover:none)');
    var lastActive = null;
    function sync() {
      var a = items.filter(function (b) { return b.classList.contains('active'); })[0];
      items.forEach(function (b) { b === a ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
      if (!a) { pill.classList.remove('on'); return; }
      var y = a.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
      pill.style.setProperty('--y', y + 'px'); pill.classList.add('on');
      if (phone.matches && a !== lastActive) { lastActive = a; try { a.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (_) {} }
    }
    // admin.js toggles .active on click; observe instead of patching it.
    var mo = new MutationObserver(sync);
    items.forEach(function (b) { mo.observe(b, { attributes: true, attributeFilter: ['class'] }); });
    window.addEventListener('resize', sync); nav.addEventListener('scroll', sync, { passive: true });
    // overlay is display:none until login → re-sync when it appears / when the rail resizes
    if (window.ResizeObserver) new ResizeObserver(sync).observe(side);
    sync();

    function setOpen(v) { side.classList.toggle('is-open', v); back.classList.toggle('show', v); }
    side.addEventListener('click', function (e) {
      return;   /* tap-to-expand drawer disabled: the sidebar now has its own toggle button (admin-nav-toggle) */   // phones: dock mode (no drawer). Touch tablets: tap-to-expand drawer
      var item = e.target.closest('.nav-item,.logout-btn');
      if (!side.classList.contains('is-open')) { e.preventDefault(); e.stopPropagation(); setOpen(true); } // first tap only expands
      else if (item) setOpen(false);                                                                    // choosing an item collapses
    }, true);
    var peekT;
    side.addEventListener('click', function (e) {          // dock: tapped item shows its label for a moment
      if (!phone.matches) return;
      var it = e.target.closest('.nav-item,.logout-btn'); if (!it) return;
      side.querySelectorAll('.peek').forEach(function (x) { x.classList.remove('peek'); });
      it.classList.add('peek'); clearTimeout(peekT); peekT = setTimeout(function () { it.classList.remove('peek'); }, 1700);
    });
    back.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setOpen(false); if (side.contains(document.activeElement)) document.activeElement.blur(); } });
    // arrow-key roving between items
    side.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var all = items.concat(logout ? [logout] : []), i = all.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
;

/* ═══ admin-theme.js ═══ */
/* admin-theme.js — dark-mode toggle for the admin overlay (button lives in the overview header).
   Remembers the choice on this device; no admin.js logic involved. */
(function () {
  'use strict';
  var KEY = 'anwarAdminTheme';
  function root() { return document.getElementById('adminOverlay'); }
  function apply(mode) { var r = root(); if (!r) return; if (mode === 'dark') r.setAttribute('data-theme', 'dark'); else r.removeAttribute('data-theme'); }
  function saved() { try { return localStorage.getItem(KEY) || 'light'; } catch (e) { return 'light'; } }
  function save(m) { try { localStorage.setItem(KEY, m); } catch (e) {} }
  function init() { apply(saved()); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]'); if (!b) return;
    var next = (root() && root().getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
    apply(next); save(next);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
;

/* ═══ product-page.js ═══ */
/* product-page.js — scroll-linked collapsing header for the product page (like Flutter's SliverAppBar).
   hero height = max(bar, H - scroll)   · image parallax (moves at half speed)
   · title fades into the pinned bar    · pull down at the top → image stretches, springs back on release. */
(function () {
  'use strict';
  window.PRODUCT_PAGE = true;   // set to false to make product cards open the old full-screen photo viewer again
  var view = document.getElementById('view-product'); if (!view) return;
  var wrap = view.querySelector('.pd-hero-wrap'), img = document.getElementById('pd-hero-img'),
      top = view.querySelector('.pd-hero-top'), nameEl = document.getElementById('pd-name'), body = view.querySelector('.pd-body');
  if (!wrap || !img || !top) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var title = document.createElement('span'); title.className = 'pd-bar-title';
  top.insertBefore(title, top.children[1] || null);          // between ← and ♡
  view.appendChild(top);                                     // bar sits above the rounded sheet
  var H = 340, BAR = 60, stretch = 0, t0 = null, raf = 0;
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function measure() {
    H = Math.round(clamp(window.innerHeight * 0.42, 280, 420));
    view.style.setProperty('--pd-h', H + 'px');
    BAR = top.offsetHeight || 60; view.style.setProperty('--pd-bar', BAR + 'px');
    try { view.style.setProperty('--pd-surface', getComputedStyle(body).backgroundColor); } catch (e) {}
    title.textContent = nameEl ? nameEl.textContent : '';
  }
  function render() {
    raf = 0;
    if (!view.classList.contains('active')) return;
    var y = window.scrollY, pos = Math.max(0, y);
    var pull = reduce.matches ? 0 : Math.max(-y, stretch);           // iOS bounce (y<0) or touch pull
    wrap.style.height = (Math.max(BAR, H - pos) + pull) + 'px';
    img.style.transform = reduce.matches ? '' : 'translateY(' + (-pos * 0.5) + 'px) scale(' + (1 + pull / H * 1.1) + ')';
    var p = clamp(pos / Math.max(1, H - BAR), 0, 1);
    view.style.setProperty('--pd-bar-o', clamp((p - 0.7) / 0.3, 0, 1).toFixed(3));
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(render); }
  function release() {
    t0 = null; if (!stretch) return;
    view.classList.add('pd-settle'); stretch = 0; render();
    setTimeout(function () { view.classList.remove('pd-settle'); }, 560);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', function () { if (view.classList.contains('active')) { measure(); schedule(); } });
  view.addEventListener('touchstart', function (e) { t0 = window.scrollY <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  view.addEventListener('touchmove', function (e) {
    if (t0 == null || reduce.matches) return;
    var dy = e.touches[0].clientY - t0;
    stretch = (dy > 0 && window.scrollY <= 0) ? Math.min(140, dy * 0.45) : 0; schedule();
  }, { passive: true });
  view.addEventListener('touchend', release, { passive: true });
  view.addEventListener('touchcancel', release, { passive: true });

  // react to the page opening/closing (openProduct / closeProduct toggle .active)
  new MutationObserver(function () {
    var on = view.classList.contains('active');
    document.documentElement.classList.toggle('pd-open', on);
    if (on) { stretch = 0; measure(); schedule(); } else { wrap.style.height = ''; img.style.transform = ''; }
  }).observe(view, { attributes: true, attributeFilter: ['class'] });
  if (nameEl) new MutationObserver(function () { title.textContent = nameEl.textContent; }).observe(nameEl, { childList: true, characterData: true, subtree: true });
})();
;

/* ═══ hero-transition.js ═══ */
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
      card.onclick(e);                                  // kiosk-app's own handler (product page or photo viewer)
      var pv = document.getElementById('view-product');
      var onPage = !!(pv && pv.classList.contains('active'));
      dest = onPage ? pv.querySelector('.pd-hero-wrap') : document.getElementById('image-menu-photo');
      if (current) current.page = onPage;
      setName(dest, id);
    });
    var dest = null;
    current = { id: id, card: card, page: false };
    t.finished.finally(function () { clearName(dest); clearName(document.getElementById('image-menu-photo')); });
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


  // CLOSE (product page): back arrow → same card. Skipped when the header is collapsed (plain fade instead).
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-act="closeProduct"]');
    if (!btn || !current || !current.page || !ok() || typeof window.closeProduct !== 'function') return;
    var c = current; current = null;
    var wrap = document.querySelector('#view-product .pd-hero-wrap');
    if (!wrap || window.scrollY > 40 || !document.body.contains(c.card)) return;
    e.stopImmediatePropagation();
    radii(rad(wrap), rad(c.card)); setName(wrap, c.id);
    var t = vt(function () {
      clearName(wrap); window.closeProduct();
      var im = c.card.querySelector('.prod-img'); setName(im, c.id);
      c.card.scrollIntoView({ block: 'nearest' });
    });
    t.finished.finally(function () { clearName(wrap); clearName(c.card.querySelector('.prod-img')); });
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
;

;
/* ═══ admin-nav-toggle.js ═══ */
/* Collapsible sidebar: ≥1024px open by default (choice remembered); 651–1023px collapsed, opens as overlay; phones use the dock. */
(function () {
  'use strict';
  var KEY = 'anwarNavCollapsed', big = window.matchMedia('(min-width:1024px)'), phone = window.matchMedia('(max-width:650px)');
  function init() {
    var root = document.getElementById('appRoot'), ov = document.getElementById('adminOverlay');
    var side = root && root.querySelector(':scope > .sidebar');
    if (!side || side.querySelector('.nav-toggle')) return;
    var back = document.createElement('div'); back.className = 'nav-backdrop'; ov.appendChild(back);
    var b = document.createElement('button'); b.type = 'button'; b.className = 'nav-toggle';
    b.innerHTML = '<span class="nt-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17l5-5-5-5M13 17l5-5-5-5"/></svg></span><span class="nt-label">إخفاء</span>';
    side.appendChild(b);
    function saved() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
    function set(c, save) {
      root.classList.toggle('nav-collapsed', c);
      b.setAttribute('aria-expanded', String(!c)); b.title = c ? 'إظهار القائمة' : 'إخفاء القائمة';
      back.classList.toggle('show', !c && !big.matches && !phone.matches);
      if (save) { try { localStorage.setItem(KEY, c ? '1' : '0'); } catch (e) {} }
    }
    function auto() { set(big.matches ? saved() : true, false); }
    b.addEventListener('click', function () { set(!root.classList.contains('nav-collapsed'), big.matches); });
    back.addEventListener('click', function () { set(true, false); });
    side.addEventListener('click', function (e) { if (!big.matches && !phone.matches && e.target.closest('.nav-item,.logout-btn')) set(true, false); });
    big.addEventListener('change', auto); phone.addEventListener('change', auto);
    auto();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

;
/* ═══ scroll-fx.js ═══ */
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

  var TARGETS = '#page-menu .menu-hero-content, #page-menu .cat-card, #page-menu .hg-card, #page-menu .prod-card, #page-menu .gallery-item,' +
                '#page-menu .inner-banner-wrap, #page-menu .section-gallery-intro, #page-menu .hero-slide-caption, #page-menu [data-fx]';
  var NEVER   = '#view-product, #adminOverlay, #kioskStartOverlay, .kiosk-top-bar, .inner-header, .section-tabs-bar,' +
                '.gallery-back-btn, .gallery-view-label, .scroll-more-indicator, .site-header, .site-page, .pg-hero, .home-search, .nav-drawer, .nav-backdrop, .back-to-top, .hs-arrow, .hs-dots, form, dialog, [role="dialog"],' +
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
  /* MAIN PAGE (#view-home): the effect starts with the very first pixel of scrolling.
       – hero content: progress follows the scroll distance over ~80% of the hero's height;
       – cards: a wider fade zone (42% of the screen), eased in by the first ~50px so nothing is faded at rest.
     Sections (#view-inner / gallery) keep the original behaviour. */
  function frame() {
    ticking = false;
    var pd = root.classList.contains('pd-open');          // product page has its own scroll-linked header
    var vh = innerHeight, sy = Math.max(0, scrollY), shift = innerWidth < 640 ? 8 : 12;
    tracked.forEach(function (el) {
      if (pd || el.matches(':hover, :focus-within')) { clear(el); return; }   // never fade what is being touched/read
      var p, home = !!el.closest('#view-home');
      if (home && (el.classList.contains('menu-hero-content') || el.classList.contains('hero-slide-caption'))) {
        var hero = el.closest('.menu-hero');
        p = Math.min(1, sy / Math.max(120, (hero ? hero.offsetHeight : 300) * 0.8));
      } else {
        var zone = vh * (home ? 0.42 : 0.3);
        p = Math.min(1, Math.max(0, (zone - el.getBoundingClientRect().bottom) / zone));
        if (home) p *= Math.min(1, sy / 50);
      }
      p = ease(p);
      if (p) { el.style.setProperty('--fx-o', (1 - p * (1 - MIN_OPACITY)).toFixed(3)); el.style.setProperty('--fx-y', (-p * shift).toFixed(1) + 'px'); }
      else clear(el);
    });
    header(pd);
  }

  /* Sub-header (.inner-header): hides on scroll down, returns on scroll up; hysteresis avoids touch flicker.
     The sticky .section-tabs-bar below it slides up with it so there is no gap. */
  function focusVisibleIn(h) { var f = document.activeElement; return !!(f && h.contains(f) && f.matches && f.matches(':focus-visible')); }
  var lastY = scrollY, acc = 0;
  function header(pd) {
    var y = Math.max(0, scrollY), dy = y - lastY; lastY = y;
    acc = (dy && Math.sign(dy) === Math.sign(acc)) ? acc + dy : dy;
    var h = document.querySelector('#view-inner.active .inner-header') || (function () { var s = document.querySelector('#page-menu > .site-header'); return s && s.offsetParent !== null ? s : null; })();
    if (!h || pd) { root.classList.remove('fx-hdr-hidden'); return; }
    root.style.setProperty('--fx-hh', h.offsetHeight + 'px');
    if (y < 80 || focusVisibleIn(h)) root.classList.remove('fx-hdr-hidden');
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
