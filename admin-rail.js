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

    function sync() {
      var a = items.filter(function (b) { return b.classList.contains('active'); })[0];
      items.forEach(function (b) { b === a ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
      if (!a) { pill.classList.remove('on'); return; }
      var y = a.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
      pill.style.setProperty('--y', y + 'px'); pill.classList.add('on');
    }
    // admin.js toggles .active on click; observe instead of patching it.
    var mo = new MutationObserver(sync);
    items.forEach(function (b) { mo.observe(b, { attributes: true, attributeFilter: ['class'] }); });
    window.addEventListener('resize', sync); nav.addEventListener('scroll', sync, { passive: true });
    // overlay is display:none until login → re-sync when it appears / when the rail resizes
    if (window.ResizeObserver) new ResizeObserver(sync).observe(side);
    sync();

    var phone = window.matchMedia('(max-width:650px)'), hoverless = window.matchMedia('(hover:none)');
    function setOpen(v) { side.classList.toggle('is-open', v); back.classList.toggle('show', v); }
    side.addEventListener('click', function (e) {
      if (!(phone.matches || hoverless.matches)) return;
      var item = e.target.closest('.nav-item,.logout-btn');
      if (!side.classList.contains('is-open')) { e.preventDefault(); e.stopPropagation(); setOpen(true); } // first tap only expands
      else if (item) setOpen(false);                                                                    // choosing an item collapses
    }, true);
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
