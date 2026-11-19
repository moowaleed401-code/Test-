import {
  liveState, setCallbacks, fetchMenuData, adminLogin, adminLogout, saveHeroSettings,
  uploadMenuImage, createCategory, updateCategory, deleteCategory,
  createProduct, updateProduct, deleteProduct,
  reorderCategories, reorderProducts,
  createOffer, updateOffer, deleteOffer, reorderOffers,
  getSeoSettings, saveSeoSettings, exportSiteBackup, importSiteBackup, resetAdminIdleTimer,
} from "./firebase-app.js?v=20261119-1";


/* ── قفل أوفرلاي الأدمن ──
   window.openAdminOverlay بقى معرّف مسبقًا في سكريبت مستقل فوق (قبل تحميل
   الموديولز) عشان يضمن إنه موجود وقت الحاجة له بدون أي مشاكل ترتيب تحميل. */
function closeAdminOverlay() {
  document.getElementById('adminOverlay').classList.remove('show');
  document.querySelector('meta[name="viewport"]').setAttribute('content', window.KIOSK_VIEWPORT);
  adminLogout();
}
document.getElementById('adminOverlayClose').addEventListener('click', closeAdminOverlay);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── auth ──
   Client-side brake on top of Firebase's own server-side throttling:
   after 5 wrong attempts the button locks for 60s (survives nothing — it is a
   speed bump only; the real rate limit is enforced by Firebase Auth). */
let loginFails = 0, loginLockedUntil = 0;
$('#loginBtn').onclick = async () => {
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  const err = $('#loginErr');
  if (!email || !password) { err.textContent = 'حط الإيميل والباسورد'; return; }
  if (Date.now() < loginLockedUntil) {
    err.textContent = 'محاولات كتير غلط — استنى ' + Math.ceil((loginLockedUntil - Date.now()) / 1000) + ' ثانية';
    return;
  }
  err.textContent = '';
  try {
    await adminLogin(email, password);
    loginFails = 0;
    $('#loginPassword').value = '';
  } catch (e) {
    loginFails++;
    if (loginFails >= 5) { loginFails = 0; loginLockedUntil = Date.now() + 60000; }
    console.error('Admin login failed:', e.code, e.message);
    const map = {
      'auth/invalid-email': 'الإيميل أو الباسورد غلط',
      'auth/user-not-found': 'الإيميل أو الباسورد غلط',
      'auth/wrong-password': 'الإيميل أو الباسورد غلط',
      'auth/invalid-credential': 'الإيميل أو الباسورد غلط',
      'auth/too-many-requests': 'محاولات كتير غلط — استنى شوية وجرب تاني',
      'auth/unauthorized-domain': 'الدومين ده مش مسموح له يسجل دخول (لازم يتضاف في Firebase Console)',
      'auth/network-request-failed': 'مفيش اتصال بالإنترنت',
    };
    err.textContent = map[e.code] || ('حصل خطأ: ' + (e.code || e.message));
  }
};
$('#logoutBtn').onclick = () => { closeAdminOverlay(); };

/* ── nav / view state ── */
let currentView = 'overview';
let settingsSection = 'hub';
let searchTerm = '';
let productCatFilter = 'all';
let heroDraftImageUrl = '';
let heroDraftImageOriginalUrl = '';
let heroDraftImagePublicId = '';
let heroDraftImageSize = { preset: 'original', width: null, height: null };
let heroDraftLogoUrl = 'logo-fallback.svg';
let heroDraftLogoPublicId = '';
let heroPendingImageFile = null;
let heroPendingImageObjectUrl = '';
let heroPendingImageToken = 0;
let heroPendingLogoFile = null;
let heroPendingLogoObjectUrl = '';
let heroSavedSnapshot = {};

const titles = {
  overview: ['نظرة عامة', 'ملخص سريع على حالة المنيو'],
  categories: ['الأقسام', 'إدارة أقسام المنيو الرئيسية'],
  products: ['الأصناف', 'كل الأصناف عبر كل الأقسام'],
  offers: ['العروض', 'إدارة عروض وخصومات "عروضنا"'],
  westernGallery: ['معرض حلويات غربية', 'إدارة صور المعرض بنفس تجربة العرض في المنيو'],
  hero: ['واجهة الـ Hero', 'تحكم كامل في واجهة الصفحة الرئيسية'],
  media: ['مكتبة الصور', 'كل الصور المستخدمة في الموقع في مكان واحد'],
  backup: ['النسخ الاحتياطي', 'تصدير واستعادة بيانات الموقع بأمان'],
  siteSettings: ['الإعدادات', 'إعدادات الموقع والـ SEO والنسخ الاحتياطي'],
};

setCallbacks({
  onAdminAuth: (user, info) => {
    if (user) {
      $('#loginScreen').style.display = 'none';
      $('#appRoot').classList.add('show');
      $('#adminMailLabel').textContent = user.email || '';
      resetAdminIdleTimer();
      render();
    } else {
      $('#appRoot').classList.remove('show');
      $('#loginScreen').style.display = 'flex';
      if (info && info.denied) $('#loginErr').textContent = 'الحساب ده مش مسموح له بدخول لوحة التحكم' + (window.__adminCheck ? ' [' + window.__adminCheck + ']' : '');
    }
  }
});

/* Auto-logout after ADMIN_IDLE_LOGOUT_MS of no interaction inside the admin overlay.
   (resetAdminIdleTimer existed in firebase-app.js but was never called before.) */
['click', 'keydown', 'pointerdown', 'touchstart', 'input'].forEach(evt => {
  $('#adminOverlay').addEventListener(evt, () => resetAdminIdleTimer(), { passive: true, capture: true });
});

if (liveState.seoSettings) applySeo(liveState.seoSettings);

$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    if (currentView === 'siteSettings') settingsSection = 'hub';
    searchTerm = '';
    productCatFilter = 'all';
    render();
  });
});

const sidebarToggle = $('#sidebarToggle');
sidebarToggle?.addEventListener('click', () => {
  const root = $('#appRoot');
  const collapsed = root.classList.toggle('sidebar-collapsed');
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggle.setAttribute('aria-label', collapsed ? 'إظهار القائمة الجانبية' : 'إخفاء القائمة الجانبية');
  sidebarToggle.title = collapsed ? 'إظهار القائمة الجانبية' : 'إخفاء القائمة الجانبية';
  sidebarToggle.querySelector('span').textContent = collapsed ? '›' : '‹';
  try { localStorage.setItem('anwarAdminSidebarCollapsed', collapsed ? '1' : '0'); } catch(e) {}
});
try {
  if (localStorage.getItem('anwarAdminSidebarCollapsed') === '1') {
    $('#appRoot').classList.add('sidebar-collapsed');
    sidebarToggle?.setAttribute('aria-expanded','false');
    sidebarToggle?.setAttribute('aria-label','إظهار القائمة الجانبية');
    if (sidebarToggle) { sidebarToggle.title='إظهار القائمة الجانبية'; sidebarToggle.querySelector('span').textContent='›'; }
  }
} catch(e) {}

$('#topSearchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderContentOnly();
});

function render() {
  const [title, sub] = titles[currentView];
  $('#pageTitle').textContent = title;
  $('#pageSub').textContent = sub;
  const crumb = $('#pageTitleCrumb'); if (crumb) crumb.textContent = title;
  const lastUpdate = $('#adminLastUpdate'); if (lastUpdate) lastUpdate.textContent = 'الآن';
  $('#topSearchWrap').style.display = ['overview','hero','media','backup','siteSettings'].includes(currentView) ? 'none' : 'block';
  $('#topSearchInput').value = '';
  renderContentOnly();
}

function renderContentOnly() {
  const content = $('#content');
  if (currentView === 'overview') content.innerHTML = renderOverview();
  else if (currentView === 'media') content.innerHTML = renderMediaLibrary();
  else if (currentView === 'backup') content.innerHTML = renderBackupPage();
  else if (currentView === 'siteSettings') { content.innerHTML = renderSiteSettings(); if (settingsSection === 'seo') setTimeout(loadSiteSettingsEditor, 0); }
  else if (currentView === 'categories') content.innerHTML = renderCategoriesTable();
  else if (currentView === 'products') content.innerHTML = renderProductsTable();
  else if (currentView === 'offers') content.innerHTML = renderOffersTable();
  else if (currentView === 'westernGallery') content.innerHTML = renderWesternGalleryAdmin();
  else if (currentView === 'hero') content.innerHTML = renderHeroSettings();
  wireContentEvents();
}

function allProductsFlat() {
  const out = [];
  for (const catId in liveState.products) {
    (liveState.products[catId] || []).forEach(p => out.push({ ...p, categoryId: catId }));
  }
  return out;
}


/* ── dashboard (overview) helpers ── */
const DSH_IC = {
  cat:'<path d="M4 6h16M4 12h16M4 18h10"/>',
  prod:'<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>',
  offer:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  gal:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
  up:'<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  moon:'<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  warn:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  hero:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  seo:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  backup:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  arrowL:'<path d="M19 12H5M11 6l-6 6 6 6"/>'
};
const dshIc = k => `<svg class="dsh-svg" viewBox="0 0 24 24" aria-hidden="true">${DSH_IC[k] || ''}</svg>`;
function timeAgoAr(sec) {
  if (!sec) return '';
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return 'الآن';
  if (d < 3600) return `منذ ${Math.floor(d / 60)} دقيقة`;
  if (d < 86400) return `منذ ${Math.floor(d / 3600)} ساعة`;
  return `منذ ${Math.floor(d / 86400)} يوم`;
}

function renderOverview() {
  const cats = liveState.categories;
  const products = allProductsFlat();
  const offers = liveState.offers || [];
  const galleries = cats.filter(c => c.displayType === 'gallery').reduce((n,c) => n + (Array.isArray(c.galleryImages) ? c.galleryImages.length : 0), 0);
  const hiddenCats = cats.filter(c => !c.visible).length;
  const hiddenProds = products.filter(p => !p.visible).length;
  const priced = products.filter(p => p.price != null || (p.sizePrices && p.sizePrices.length)).length;
  const activeOffers = offers.filter(o => o.visible !== false && (!o.endAt || new Date(o.endAt).getTime() > Date.now())).length;
  const recentCats = [...cats].sort((a,b) => Number(b.updatedAt?.seconds || b.displayOrder || 0) - Number(a.updatedAt?.seconds || a.displayOrder || 0)).slice(0,6);
  const online = liveState.isOnline;
  const visibleCats = cats.length - hiddenCats;
  const visibleProducts = products.length - hiddenProds;
  const noPrice = products.length - priced;
  const secOf = x => Number(x?.updatedAt?.seconds || x?.createdAt?.seconds || 0);
  const feed = [
    ...cats.map(c => ({ ic:'cat', color:'blue', name:c.name, kind: c.displayType === 'gallery' ? 'قسم معرض' : 'قسم', on:c.visible, sec:secOf(c) })),
    ...products.map(p => ({ ic:'prod', color:'green', name:p.name, kind:'صنف', on:p.visible, sec:secOf(p) })),
    ...offers.map(o => ({ ic:'offer', color:'purple', name:o.titleAr || o.titleEn, kind:'عرض', on:o.visible !== false, sec:secOf(o) })),
  ].filter(x => x.name).sort((a, b) => b.sec - a.sec).slice(0, 6);
  const pct = n => products.length ? Math.round(n / products.length * 100) : 0;
  const withImg = products.filter(p => p.imageUrl).length;
  const withDesc = products.filter(p => p.description).length;
  const bars = [
    ['أصناف ظاهرة للزوار', visibleProducts, 'blue'],
    ['أصناف لها سعر', priced, 'green'],
    ['أصناف لها صورة', withImg, 'purple'],
    ['أصناف لها وصف', withDesc, 'orange'],
  ];
  const review = products.filter(p => !(p.price != null || (p.sizePrices && p.sizePrices.length)) || !p.imageUrl).slice(0, 4);
  return `
    <div class="erp-dashboard-head dsh-head">
      <div><div class="eyebrow">ANWAR LEBANON • OPERATIONS</div><h2>أهلاً بيك في لوحة التحكم</h2><p>إدارة المنيو والمحتوى والتحديثات اليومية من شاشة واحدة.</p></div>
      <div class="dashboard-actions">
        <button class="dsh-theme" type="button" data-theme-toggle aria-label="تبديل الوضع الليلي" title="الوضع الليلي"><span class="dsh-moon">${dshIc('moon')}</span><span class="dsh-sun">${dshIc('sun')}</span></button>
        <button class="btn ghost" data-jump="categories">+ إضافة قسم</button><button class="btn gold" data-jump="products">+ إضافة صنف</button>
      </div>
    </div>
    <div class="dsh-stats">
      <div class="dsh-card"><div class="dsh-card-top"><span class="dsh-chip blue">${dshIc('cat')}</span><span class="dsh-trend">${dshIc('up')}</span></div><h3>إجمالي الأقسام</h3><p class="dsh-num">${cats.length}</p><p class="dsh-sub">${visibleCats} ظاهر للزوار</p></div>
      <div class="dsh-card"><div class="dsh-card-top"><span class="dsh-chip green">${dshIc('prod')}</span><span class="dsh-trend">${dshIc('up')}</span></div><h3>إجمالي الأصناف</h3><p class="dsh-num">${products.length}</p><p class="dsh-sub">${visibleProducts} ظاهر للزوار</p></div>
      <div class="dsh-card"><div class="dsh-card-top"><span class="dsh-chip purple">${dshIc('offer')}</span><span class="dsh-trend">${dshIc('up')}</span></div><h3>العروض النشطة</h3><p class="dsh-num">${activeOffers}</p><p class="dsh-sub">من ${offers.length} عرض</p></div>
      <div class="dsh-card"><div class="dsh-card-top"><span class="dsh-chip orange">${dshIc('gal')}</span><span class="dsh-trend">${dshIc('up')}</span></div><h3>صور المعارض</h3><p class="dsh-num">${galleries}</p><p class="dsh-sub">صورة مستخدمة</p></div>
    </div>
    <div class="dsh-grid">
      <div class="dsh-panel dsh-wide">
        <div class="dsh-panel-head"><h3>آخر التحديثات</h3><button class="dsh-link" type="button" data-jump="products">عرض الكل</button></div>
        <div class="dsh-feed">
          ${feed.map(f => `<div class="dsh-row"><span class="dsh-chip sm ${f.color}">${dshIc(f.ic)}</span><div class="dsh-row-main"><p class="dsh-row-title">${escAttr(f.name)}</p><p class="dsh-row-sub">${f.kind} • ${f.on ? 'ظاهر' : 'مخفي'}</p></div><span class="dsh-time">${timeAgoAr(f.sec)}</span></div>`).join('') || '<div class="dsh-empty">مفيش تحديثات لسه</div>'}
        </div>
      </div>
      <div class="dsh-side">
        <div class="dsh-panel">
          <div class="dsh-panel-head"><h3>جودة المحتوى</h3></div>
          <div class="dsh-bars">
            ${bars.map(([label, n, c]) => `<div class="dsh-bar"><div class="dsh-bar-top"><span>${label}</span><b>${pct(n)}%</b></div><div class="dsh-track"><i class="${c}" style="width:${pct(n)}%"></i></div></div>`).join('')}
          </div>
        </div>
        <div class="dsh-panel">
          <div class="dsh-panel-head"><h3>تحتاج مراجعة</h3>${review.length ? `<span class="dsh-badge">${noPrice + products.filter(p => !p.imageUrl).length}</span>` : ''}</div>
          <div class="dsh-review">
            ${review.map(p => `<button class="dsh-review-row" type="button" data-jump="products"><span class="dsh-review-name">${escAttr(p.name || 'بدون اسم')}</span><span class="dsh-tags">${!(p.price != null || (p.sizePrices && p.sizePrices.length)) ? '<em>بدون سعر</em>' : ''}${!p.imageUrl ? '<em>بدون صورة</em>' : ''}</span></button>`).join('') || '<div class="dsh-empty ok">كل الأصناف مكتملة ✅</div>'}
          </div>
        </div>
      </div>
    </div>
    <div class="admin-health-grid">
      <div class="health-card"><span class="health-dot ${online?'ok':'bad'}"></span><div><b>${online?'النظام متصل':'وضع Offline'}</b><small>${online?'Firebase متصل والبيانات قابلة للحفظ والتحديث':'المعروض آخر نسخة متاحة في الصفحة'}</small></div></div>
      <div class="health-card"><span class="health-icon">₪</span><div><b>${priced} صنف عنده سعر</b><small>${noPrice} صنف يحتاج مراجعة السعر</small></div></div>
      <div class="health-card"><span class="health-icon">✧</span><div><b>واجهة الموقع</b><small>${liveState.heroSettings?.imageUrl ? 'Hero مخصص ومفعّل' : 'Hero يستخدم الإعداد الافتراضي'}</small></div></div>
    </div>
    <div class="dashboard-summary-full">
      <div class="panel dashboard-table">
        <div class="panel-head"><div><h3>ملخص الأقسام</h3><div class="panel-sub">آخر الأقسام وتركيبة المحتوى داخل كل قسم</div></div><span class="cnt">${cats.length} قسم</span></div>
        <div class="table-scroll"><table><thead><tr><th>القسم</th><th>الأصناف</th><th>النوع</th><th>الحالة</th></tr></thead><tbody>
          ${recentCats.map(c => `<tr class="row"><td><div class="cell-name"><img class="cell-thumb" src="${escAttr(thumbUrl(c.imageUrl || ''))}" alt="" loading="lazy" decoding="async"/><div><div class="n">${escAttr(c.name)}</div><div class="s">${c.displayType === 'gallery' ? 'Gallery' : 'Products'}</div></div></div></td><td>${(liveState.products[c.id] || []).length}</td><td>${c.displayType === 'gallery' ? 'معرض' : 'منيو'}</td><td><span class="badge ${c.visible ? 'on' : 'off'}">${c.visible ? 'نشط' : 'مخفي'}</span></td></tr>`).join('') || `<tr class="empty-row"><td colspan="4">مفيش أقسام لسه</td></tr>`}
        </tbody></table></div>
        <div class="dashboard-note">ملاحظة: الترتيب والظهور هنا بيتبع نفس البيانات اللي بيستخدمها الموقع للزوار.</div>
      </div>
    </div>
    <div class="dashboard-lower-grid">
      <div class="panel"><div class="panel-head"><div><h3>إجراءات سريعة</h3><div class="panel-sub">المهام الأكثر استخدامًا</div></div></div><div class="quick-actions">
          <button class="quick-action" data-jump="products"><div class="qa-ic">◇</div><div><b>إدارة الأصناف</b><span>إضافة • تعديل • ترتيب</span></div></button>
          <button class="quick-action" data-jump="categories"><div class="qa-ic">▦</div><div><b>إدارة الأقسام</b><span>الظهور • الترتيب</span></div></button>
          <button class="quick-action" data-jump="offers"><div class="qa-ic">✦</div><div><b>العروض</b><span>تحديث المحتوى</span></div></button>
          <button class="quick-action" data-jump="media"><div class="qa-ic">◫</div><div><b>مكتبة الصور</b><span>مراجعة الاستخدام</span></div></button>
        </div></div>
    </div>`;
}
function collectMediaLibrary() {
  const map = new Map();
  const add = (url, usage, publicId='') => {
    const u = String(url || '').trim(); if (!u) return;
    const key = u;
    if (!map.has(key)) map.set(key, { url:u, usage:[], publicId:publicId||'' });
    const item = map.get(key); if (!item.usage.includes(usage)) item.usage.push(usage); if (publicId) item.publicId=publicId;
  };
  const cats = liveState.categories || [];
  cats.forEach(c => { add(c.imageUrl, `قسم: ${c.name}`); add(c.bannerImageUrl, `بانر: ${c.name}`); (c.galleryImages||[]).forEach((u,i)=>add(u, `معرض: ${c.name} #${i+1}`)); });
  allProductsFlat().forEach(p => add(p.imageUrl, `صنف: ${p.name || 'بدون اسم'}`));
  (liveState.offers||[]).forEach(o => add(o.image||o.imageUrl, `عرض: ${o.titleAr||o.titleEn||'بدون عنوان'}`));
  add(liveState.heroSettings?.imageUrl, 'Hero'); add(liveState.heroSettings?.logo?.url, 'Hero Logo');
  return [...map.values()];
}

function renderMediaLibrary() {
  const media = collectMediaLibrary();
  const q = searchTerm;
  const filtered = media.filter(m => !q || (m.url+' '+m.usage.join(' ')).toLowerCase().includes(q));
  return `<div class="media-toolbar"><div><b>مكتبة الصور</b><span>${media.length} صورة مستخدمة حاليًا</span></div><button class="btn ghost sm" id="refreshMediaBtn">↻ تحديث</button></div>
    <div class="media-note">المكتبة هنا بتعرض الصور المرتبطة فعليًا ببيانات الموقع. الحذف من Cloudinary لا يتم من المتصفح لأن مفتاح Cloudinary السري لا يجب وضعه داخل الموقع.</div>
    <div class="media-grid">${filtered.map((m,i)=>`<article class="media-card"><div class="media-thumb"><img src="${escAttr(thumbUrl(m.url, 400))}" alt="" loading="lazy" decoding="async"/></div><div class="media-body"><b>${escAttr(m.usage[0]||'صورة')}</b><small>${escAttr(m.usage.slice(1).join(' • ') || 'مستخدمة في الموقع')}</small><button class="btn ghost sm media-copy" data-url="${escAttr(m.url)}">نسخ رابط الصورة</button></div></article>`).join('') || `<div class="media-empty">مفيش صور مطابقة.</div>`}</div>`;
}

function renderBackupPage() {
  return `<div class="settings-grid-simple">
    <div class="panel"><div class="panel-head"><div><h3>نسخة احتياطية</h3><p class="panel-sub">احتفظ بنسخة من بيانات الموقع قبل أي تعديل كبير.</p></div></div><div class="backup-actions"><button class="btn gold" id="exportBackupBtn">⬇️ تصدير نسخة احتياطية</button><label class="btn ghost" for="importBackupInput">⬆️ استعادة نسخة</label><input id="importBackupInput" type="file" accept="application/json,.json" hidden></div><div class="backup-warning">⚠️ الاستعادة تستبدل بيانات الأقسام والأصناف والعروض. المصادقة وحساب الأدمن لا تدخل في النسخة.</div></div>
    <div class="panel"><div class="panel-head"><div><h3>ما الذي يتم حفظه؟</h3></div></div><ul class="backup-list"><li>الأقسام وترتيبها وصورها</li><li>كل الأصناف والأسعار والتفاصيل</li><li>العروض وترتيبها</li><li>إعدادات Hero وSEO</li></ul></div>
  </div>`;
}

let siteSettingsDraft = null;
function renderSiteSettings() {
  if (settingsSection === 'hub') {
    return `<div class="settings-hub-intro"><h2>الإعدادات</h2><p>كل إعدادات الإدارة العامة للموقع متجمعة هنا بشكل مرتب.</p></div>
      <div class="settings-hub">
        <button class="settings-card" data-settings-section="hero"><span class="sc-icon blue">${dshIc('hero')}</span><h3>واجهة الـ Hero</h3><p>الصورة الرئيسية، المقاسات، الـ Overlay، المحتوى، اللوجو والحركة.</p><span class="sc-arrow">فتح الإعدادات ${dshIc('arrowL')}</span></button>
        <button class="settings-card" data-settings-section="slider"><span class="sc-icon blue">🖼</span><h3>سلايدر الصور (Hero)</h3><p>رفع وترتيب وتفعيل صور الهيرو، العناوين والأزرار، ومدة التنقل التلقائي.</p><span class="sc-arrow">فتح الإعدادات ${dshIc('arrowL')}</span></button>
        <button class="settings-card" data-settings-section="promo"><span class="sc-icon green">🏷</span><h3>البانر الترويجي للرئيسية</h3><p>صورة البانر العريضة تحت الأقسام: رفع، استبدال، تفعيل أو إخفاء، ورابط اختياري.</p><span class="sc-arrow">فتح الإعدادات ${dshIc('arrowL')}</span></button>
        <button class="settings-card" data-settings-section="drawer"><span class="sc-icon purple">☰</span><h3>روابط القائمة الجانبية</h3><p>واتساب، رقم الاتصال، ورابط الموقع الظاهرة في قائمة الهامبرجر.</p><span class="sc-arrow">فتح الإعدادات ${dshIc('arrowL')}</span></button>
        <button class="settings-card" data-settings-section="pages"><span class="sc-icon blue">📄</span><h3>صفحات الموقع</h3><p>الفروع والكيترنج وتابعنا: المحتوى والصور والترتيب، وتظهر بس لما تتفعّل.</p><span class="sc-arrow">فتح الإعدادات ${dshIc('arrowL')}</span></button>
        <button class="settings-card" data-settings-section="seo"><span class="sc-icon purple">${dshIc('seo')}</span><h3>SEO وبيانات الموقع</h3><p>اسم الموقع، العنوان، الوصف، الكلمات المفتاحية، صورة المشاركة ولون المتصفح.</p><span class="sc-arrow">فتح الإعدادات ${dshIc('arrowL')}</span></button>
        <button class="settings-card" data-settings-section="backup"><span class="sc-icon green">${dshIc('backup')}</span><h3>النسخ الاحتياطي</h3><p>تصدير نسخة من بيانات الموقع واستعادتها بأمان عند الحاجة.</p><span class="sc-arrow">فتح الإعدادات ${dshIc('arrowL')}</span></button>
      </div>`;
  }
  const back = `<div class="settings-section-head"><button class="settings-back" id="settingsBackBtn">→</button><div><h2 style="font-size:18px;font-weight:900">${settingsTitleOf(settingsSection)}</h2><p class="panel-sub">الإعدادات العامة للموقع</p></div></div>`;
  if (settingsSection === 'hero') return back + renderHeroSettings();
  if (settingsSection === 'slider') return back + renderSliderSettings();
  if (settingsSection === 'promo') return back + renderPromoSettings();
  if (settingsSection === 'drawer') return back + renderDrawerSettings();
  if (settingsSection === 'pages') return back + renderPagesSettings();
  if (settingsSection === 'backup') return back + renderBackupPage();
  return back + `<div id="siteSettingsMount"><div class="panel"><div class="loading-state">⏳ جاري تحميل إعدادات الموقع...</div></div></div>`;
}

async function loadSiteSettingsEditor() {
  const mount = $('#siteSettingsMount'); if (!mount) return;
  try { siteSettingsDraft = await getSeoSettings(); } catch { siteSettingsDraft = null; }
  const c = siteSettingsDraft || {};
  mount.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>SEO وبيانات الموقع</h3><p class="panel-sub">رتّب بيانات ظهور الموقع في محركات البحث والمشاركة الاجتماعية من مكان واحد.</p></div></div>
    <div class="settings-form-grid">
      <div class="settings-field"><label>اسم الموقع</label><input id="seoSiteName" value="${escAttr(c.siteName)}" placeholder="Anwar Lebanon Bakery"></div>
      <div class="settings-field"><label>عنوان الصفحة</label><input id="seoTitle" value="${escAttr(c.title)}" placeholder="يفضل أقل من 60 حرفًا"><div class="field-help">يفضل أقل من 60 حرفًا.</div></div>
      <div class="settings-field full"><label>وصف الموقع</label><textarea id="seoDescription" rows="4" placeholder="وصف مختصر وواضح للمخبز والموقع">${escAttr(c.description)}</textarea><div class="field-help">وصف مختصر وواضح للبحث والمشاركة.</div></div>
      <div class="settings-field full"><label>الكلمات المفتاحية</label><input id="seoKeywords" value="${escAttr(c.keywords)}" placeholder="مخبوزات، حلويات، كيك، Anwar Lebanon Bakery"></div>
      <div class="settings-field full"><label>رابط صورة المشاركة (اختياري)</label><input id="seoOgImage" value="${escAttr(c.ogImage)}" placeholder="https://..."></div>
      <div class="settings-field color-field"><div><label>لون المتصفح</label><div class="field-help">يظهر في واجهة المتصفح وبعض عناصر المشاركة.</div></div><input id="seoThemeColor" type="color" value="${escAttr(c.themeColor || '#0A3626')}"></div>
    </div>
    <div class="settings-actions"><button class="btn gold" id="saveSeoBtn">حفظ إعدادات الموقع</button><button class="btn ghost" id="resetSeoBtn">إعادة المحفوظ</button></div></div>`;
  wireSiteSettings();
}
function wireSiteSettings() {
  $('#saveSeoBtn')?.addEventListener('click', async () => {
    const btn=$('#saveSeoBtn'); btn.disabled=true; btn.textContent='جاري الحفظ...';
    try { siteSettingsDraft = await saveSeoSettings({siteName:$('#seoSiteName').value.trim(), title:$('#seoTitle').value.trim(), description:$('#seoDescription').value.trim(), keywords:$('#seoKeywords').value.trim(), ogImage:$('#seoOgImage').value.trim(), themeColor:$('#seoThemeColor').value}); applySeo(siteSettingsDraft); showToast('✅ اتحفظت إعدادات الموقع'); }
    catch(e){ showToast('⚠️ '+(e?.message||'حصل خطأ في الحفظ')); }
    finally{btn.disabled=false;btn.textContent='حفظ إعدادات الموقع';}
  });
  $('#resetSeoBtn')?.addEventListener('click', () => loadSiteSettingsEditor());
}

function applySeo(c) {
  if (!c) return;
  document.title = c.title || c.siteName || document.title;
  const set=(id,v)=>{const e=$(id);if(e&&v!=null)e.setAttribute('content',v);};
  set('#metaDescription', c.description); set('#metaKeywords', c.keywords); set('#metaThemeColor', c.themeColor); set('#metaOgTitle', c.title); set('#metaOgDescription', c.description); if(c.ogImage) set('#metaOgImage', c.ogImage);
  let ld=document.getElementById('siteJsonLd'); if(!ld){ld=document.createElement('script');ld.type='application/ld+json';ld.id='siteJsonLd';document.head.appendChild(ld);}
  ld.textContent=JSON.stringify({"@context":"https://schema.org","@type":"Bakery","name":c.siteName||'أنوار لبنان Bakery & Sweets',"description":c.description||'',"image":c.ogImage?[c.ogImage]:undefined},null,0);
}

function findWesternGalleryCategory() {
  return liveState.categories.find(c =>
    c.displayType === 'gallery' && String(c.name || '').includes('حلويات غربية')
  ) || null;
}

function renderWesternGalleryAdmin() {
  const cat = findWesternGalleryCategory();
  if (!cat) {
    return `
      <div class="panel">
        <div class="panel-head"><div><h3>معرض حلويات غربية</h3><div style="font-size:12px;color:var(--text-mid);margin-top:3px;">إدارة كاملة لمعرض الصور.</div></div></div>
        <div style="padding:24px;color:var(--text-mid);font-size:13px;line-height:1.8;">مش لاقي قسم "حلويات غربية" من نوع معرض صور. عدّلي نوع القسم من صفحة الأقسام أو أنشئي القسم أولًا.</div>
      </div>`;
  }

  const images = Array.isArray(cat.galleryImages) ? cat.galleryImages.filter(Boolean) : [];
  return `
    <div class="panel">
      <div class="panel-head">
        <div>
          <div style="display:flex;align-items:center;gap:10px;"><button class="btn ghost sm" id="westernBackBtn">← رجوع</button><h3>معرض حلويات غربية</h3></div>
          <div style="font-size:12px;color:var(--text-mid);margin-top:3px;">إضافة، استبدال، حذف، وترتيب الصور + إعدادات القسم.</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn gold sm" id="westernAddImagesBtn">+ إضافة صور</button>
          <button class="btn ghost sm" id="westernEditCatBtn">✏️ إعدادات القسم</button>
        </div>
      </div>
      <input type="file" id="westernImagesInput" accept="image/*" multiple style="display:none;"/>
      <input type="file" id="westernReplaceInput" accept="image/*" style="display:none;"/>
      <div class="western-admin-grid" id="westernAdminGrid">
        ${images.map((url, i) => `
          <div class="western-admin-item" draggable="true" data-index="${i}">
            <div class="western-admin-thumb"><img src="${escAttr(url)}" alt="صورة ${i+1}"/></div>
            <div class="western-admin-meta">
              <span class="western-admin-index">صورة ${i+1}</span>
              <div class="western-admin-actions">
                <span class="western-admin-drag" title="اسحب للترتيب">⠿</span>
                <button class="icon-btn western-edit-image" data-index="${i}" title="استبدال الصورة">✏️</button>
                <button class="icon-btn del western-del-image" data-index="${i}" title="حذف الصورة">🗑</button>
              </div>
            </div>
          </div>`).join('') || `<div class="western-admin-empty">مفيش صور في المعرض لسه.<br><span style="font-size:12px;">استخدمي زر «إضافة صور» للبدء.</span></div>`}
      </div>
      <div class="drag-hint">🖐 اسحب أي صورة لتغيير ترتيبها — الترتيب ده هو ترتيب المعرض عند العميل.</div>
    </div>`;
}

async function saveWesternGalleryImages(images) {
  const cat = findWesternGalleryCategory();
  if (!cat) throw new Error('قسم حلويات غربية غير موجود');
  await updateCategory(cat.id, { galleryImages: images });
  await refreshAndRerender();
}

async function addWesternGalleryImages(files) {
  if (!files || !files.length) return;
  const cat = findWesternGalleryCategory();
  if (!cat) return;
  const existing = Array.isArray(cat.galleryImages) ? cat.galleryImages.filter(Boolean) : [];
  try {
    showToast('⏳ جاري رفع الصور...');
    const uploaded = [];
    for (const file of files) {
      const result = await uploadMenuImage(file);
      if (result?.url) uploaded.push(result.url);
    }
    await updateCategory(cat.id, { galleryImages: [...existing, ...uploaded] });
    showToast(`✅ اتضاف ${uploaded.length} صورة`);
    await refreshAndRerender();
  } catch (err) {
    console.error('Western gallery upload failed:', err);
    showToast(`⚠️ ${err?.message || 'حصل خطأ في رفع الصور'}`);
  }
}

async function replaceWesternGalleryImage(index, file) {
  const cat = findWesternGalleryCategory();
  const images = Array.isArray(cat?.galleryImages) ? [...cat.galleryImages] : [];
  if (!cat || !images[index]) return;
  try {
    showToast('⏳ جاري استبدال الصورة...');
    const uploaded = await uploadMenuImage(file);
    if (!uploaded?.url) throw new Error('رفع الصورة فشل');
    images[index] = uploaded.url;
    await updateCategory(cat.id, { galleryImages: images });
    showToast('✅ اتبدلت الصورة');
    await refreshAndRerender();
  } catch (err) {
    console.error('Western gallery replace failed:', err);
    showToast(`⚠️ ${err?.message || 'حصل خطأ في استبدال الصورة'}`);
  }
}

function wireWesternGalleryDrag() {
  const grid = $('#westernAdminGrid');
  if (!grid) return;
  let dragged = null;
  grid.querySelectorAll('.western-admin-item').forEach(item => {
    item.addEventListener('dragstart', () => { dragged = item; item.classList.add('dragging'); });
    item.addEventListener('dragend', async () => {
      item.classList.remove('dragging');
      if (!dragged) return;
      const ids = Array.from(grid.querySelectorAll('.western-admin-item')).map(x => +x.dataset.index);
      const cat = findWesternGalleryCategory();
      const old = Array.isArray(cat?.galleryImages) ? cat.galleryImages : [];
      const reordered = ids.map(i => old[i]).filter(Boolean);
      dragged = null;
      try {
        await updateCategory(cat.id, { galleryImages: reordered });
        showToast('✅ اتغير ترتيب صور المعرض');
        await refreshAndRerender();
      } catch (err) {
        showToast('⚠️ حصل خطأ في حفظ الترتيب');
      }
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragged || dragged === item) return;
      const rect = item.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      grid.insertBefore(dragged, after ? item.nextSibling : item);
    });
  });
}

function renderCategoriesTable() {
  const q = searchTerm;
  const cats = liveState.categories.filter(c => !q || (c.name || '').toLowerCase().includes(q));
  const canDrag = !q;
  return `
    <div class="panel">
      <div class="panel-head">
        <h3>الأقسام الرئيسية</h3>
        <div style="display:flex; gap:8px;">
          <button class="btn ghost sm" id="visualReorderBtn">🖼️ رتّب زي شكل المنيو</button>
          <button class="btn gold sm" id="addCatBtn">+ قسم جديد</button>
        </div>
      </div>
      <div class="table-scroll">
      <table>
        <thead><tr><th></th><th>القسم</th><th>النوع</th><th>عدد الأصناف</th><th>الحالة</th><th></th></tr></thead>
        <tbody id="catsTbody">
          ${cats.map(c => `
            <tr class="row" ${canDrag ? `draggable="true" data-id="${escAttr(c.id)}"` : ''}>
              <td class="drag-handle">${canDrag ? '⠿' : ''}</td>
              <td><div class="cell-name"><img class="cell-thumb" src="${escAttr(thumbUrl(c.imageUrl || ''))}" alt="" loading="lazy" decoding="async"/><div class="n">${escAttr(c.name)}</div></div></td>
              <td>${c.displayType === 'image' ? 'صورة منيو' : c.displayType === 'gallery' ? 'معرض صور' : c.displayType === 'offers' ? '🎁 عروضنا (Offers Experience)' : (c.sections && c.sections.length ? `قسم أصناف (${c.sections.length} قسم فرعي)` : 'قسم أصناف')}</td>
              <td>${(liveState.products[c.id] || []).length} صنف</td>
              <td><span class="badge ${c.visible ? 'on' : 'off'}">${c.visible ? 'ظاهر' : 'مخفي'}</span></td>
              <td>
                <div class="row-actions">
                  <button class="icon-btn edit-cat" data-id="${escAttr(c.id)}">✏️</button>
                  <button class="icon-btn del del-cat" data-id="${escAttr(c.id)}">🗑</button>
                </div>
              </td>
            </tr>`).join('') || `<tr class="empty-row"><td colspan="6">مفيش أقسام مطابقة</td></tr>`}
        </tbody>
      </table>
      </div>
      ${canDrag ? `<div class="drag-hint">🖐 اسحب ⠿ لإعادة ترتيب الأقسام</div>` : `<div class="drag-hint">امسحي البحث الأول عشان ترتّبي</div>`}
    </div>`;
}

function catSubLabel(p) {
  const cat = liveState.categories.find(c => c.id === p.categoryId);
  if (!cat) return '';
  if (p.sectionId && cat.sections) {
    const sec = cat.sections.find(s => s.id === p.sectionId);
    if (sec) return `${cat.name} ← ${sec.name}`;
  }
  return cat.name || '';
}

function renderProductsTable() {
  const q = searchTerm;
  const products = allProductsFlat().filter(p =>
    (productCatFilter === 'all' || p.categoryId === productCatFilter) &&
    (!q || (p.name || '').toLowerCase().includes(q))
  );
  const canDrag = productCatFilter !== 'all' && !q;
  const chips = [`<button class="chip-filter ${productCatFilter==='all'?'active':''}" data-cat="all">الكل</button>`]
    .concat(liveState.categories.map(c => `<button class="chip-filter ${productCatFilter===c.id?'active':''}" data-cat="${c.id}">${escAttr(c.name)}</button>`));

  return `
    <div class="panel">
      <div class="panel-head">
        <h3>كل الأصناف</h3>
        <div style="display:flex; gap:8px;">
          <button class="btn ghost sm" id="addProdBulkBtn">🖼️ إضافة صور دفعة واحدة</button>
          <button class="btn gold sm" id="addProdBtn">+ صنف جديد</button>
        </div>
      </div>
      <div class="cat-filter-row">${chips.join('')}</div>
      <div class="table-scroll">
      <table style="margin-top:14px;">
        <thead><tr><th></th><th>الصنف</th><th>السعر</th><th>التقييم</th><th>الحالة</th><th></th></tr></thead>
        <tbody id="prodsTbody">
          ${products.map(p => `
            <tr class="row" ${canDrag ? `draggable="true" data-id="${escAttr(p.id)}"` : ''}>
              <td class="drag-handle">${canDrag ? '⠿' : ''}</td>
              <td><div class="cell-name"><img class="cell-thumb" src="${escAttr(thumbUrl(p.imageUrl || ''))}" alt="" loading="lazy" decoding="async"/><div><div class="n">${escAttr(p.name)}</div><div class="s">${escAttr(catSubLabel(p))}</div></div></div></td>
              <td>${p.sizePrices && p.sizePrices.length
                  ? `<span class="price-tag">${p.sizePrices.map(s => `${escAttr(s.name)}: ${escAttr(s.price)}`).join(' / ')}</span>`
                  : (p.price != null ? `<span class="price-tag">${escAttr(p.price)} AED</span>` : `<span class="price-tag na">—</span>`)}</td>
              <td>${p.rating != null ? `⭐ ${escAttr(p.rating)}` : '—'}</td>
              <td><span class="badge ${p.visible ? 'on' : 'off'}">${p.visible ? 'ظاهر' : 'مخفي'}</span></td>
              <td>
                <div class="row-actions">
                  <button class="icon-btn edit-prod" data-id="${escAttr(p.id)}">✏️</button>
                  <button class="icon-btn del del-prod" data-id="${escAttr(p.id)}">🗑</button>
                </div>
              </td>
            </tr>`).join('') || `<tr class="empty-row"><td colspan="6">مفيش أصناف مطابقة</td></tr>`}
        </tbody>
      </table>
      </div>
      ${canDrag ? `<div class="drag-hint">🖐 اسحب ⠿ لإعادة ترتيب الأصناف جوا القسم ده</div>` : `<div class="drag-hint">اختاري قسم معيّن (مش الكل) وامسحي البحث عشان ترتّبي بالسحب</div>`}
    </div>`;
}

/* ══════════════════════════════════════
   العروض (عروضنا) — إدارة كاملة من نفس لوحة التحكم
   القسم نفسه "عروضنا" اللي بيظهر في المنيو هو تصنيف عادي بحقل
   displayType:'offers' (بنفس أسلوب 'image'/'gallery' الموجود)،
   لكن محتواه بيتخزن في كوليكشن "offers" منفصل عن "products"
   عشان شكل وسلوك الكارت يختلف تمامًا عن كارت الصنف العادي.
══════════════════════════════════════ */
function findOffersCategory() {
  return liveState.categories.find(c => c.displayType === 'offers') || null;
}

function offerDiscountPercentAdmin(o) {
  if (o.discountPercent != null && o.discountPercent !== '') return Math.round(o.discountPercent);
  const orig = Number(o.originalPrice), disc = Number(o.discountPrice);
  if (orig > 0 && disc >= 0 && disc <= orig) return Math.round(((orig - disc) / orig) * 100);
  return null;
}

function offerStatusBadge(o) {
  const now = Date.now();
  if (o.visible === false) return `<span class="badge off">مخفي</span>`;
  if (o.endAt) {
    const e = new Date(o.endAt).getTime();
    if (!isNaN(e) && now > e) return `<span class="badge off">منتهي</span>`;
  }
  if (o.startAt) {
    const s = new Date(o.startAt).getTime();
    if (!isNaN(s) && now < s) return `<span class="badge off">لسه هيبدأ</span>`;
  }
  return `<span class="badge on">شغّال</span>`;
}

async function handleCreateOffersCategory() {
  try {
    await createCategory({
      name: 'عروضنا', displayType: 'offers', imageUrl: '', bannerImageUrl: '',
      tag: '', emoji: '🎁', sections: [], offers: [], visible: true, displayOrder: liveState.categories.length,
    });
    showToast('✅ اتضاف قسم "عروضنا" للمنيو');
    await refreshAndRerender();
  } catch (err) {
    showToast('⚠️ حصل خطأ في إضافة القسم');
  }
}

function renderOffersTable() {
  const offersCat = findOffersCategory();
  const q = searchTerm;
  const offers = [...liveState.offers].filter(o => !q || ((o.titleAr || '') + ' ' + (o.titleEn || '') + ' ' + (o.badge || '')).toLowerCase().includes(q));
  const canDrag = !q;

  const missingCatBanner = !offersCat ? `
    <div class="panel" style="padding:18px 22px; display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;">
      <div>
        <div style="font-weight:800; font-size:14px;">قسم "عروضنا" لسه مش ظاهر في المنيو</div>
        <div style="font-size:12.5px; color:var(--text-mid); margin-top:3px;">دوسي الزرار عشان تضيفيه للصفحة الرئيسية — هيظهر زي أي قسم عادي، ولما العميل يفتحه هيشوف العروض بالتصميم المخصوص ده.</div>
      </div>
      <button class="btn gold sm" id="createOffersCatBtn">+ إضافة قسم عروضنا للمنيو</button>
    </div>` : '';

  const catVisibilityRow = offersCat ? `
    <div class="panel" style="padding:16px 22px; display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:12px;">
        <img class="cell-thumb" src="${escAttr(offersCat.imageUrl || '')}" alt="" style="background:var(--green-pale);"/>
        <div>
          <div style="font-weight:800; font-size:13.5px;">قسم "عروضنا" في المنيو الرئيسي</div>
          <div style="font-size:11.5px; color:var(--text-mid); margin-top:2px;">صورة القسم واسمه بيتعدّلوا من "الأقسام" العادية — هنا بس بتتحكمي في ظهوره.</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="badge ${offersCat.visible ? 'on' : 'off'}">${offersCat.visible ? 'ظاهر' : 'مخفي'}</span>
        <button class="btn ghost sm" id="editOffersCatBtn">✏️ تعديل القسم</button>
      </div>
    </div>` : '';

  return `
    ${missingCatBanner}
    ${catVisibilityRow}
    <div class="panel">
      <div class="panel-head">
        <div style="display:flex;align-items:center;gap:10px;"><button class="btn ghost sm" id="offersBackBtn">← رجوع</button><h3>العروض</h3></div>
        <div style="display:flex; gap:8px;">
          <button class="btn gold sm" id="addOfferBtn">+ عرض جديد</button>
        </div>
      </div>
      <div class="table-scroll">
      <table>
        <thead><tr><th></th><th>العرض</th><th>السعر</th><th>الخصم</th><th>العرض كصورة فقط</th><th>مميّز</th><th>الحالة</th><th></th></tr></thead>
        <tbody id="offersTbody">
          ${offers.map(o => {
            const pct = offerDiscountPercentAdmin(o);
            return `
            <tr class="row" ${canDrag ? `draggable="true" data-id="${escAttr(o.id)}"` : ''}>
              <td class="drag-handle">${canDrag ? '⠿' : ''}</td>
              <td><div class="cell-name"><img class="cell-thumb" src="${escAttr(thumbUrl(o.image || o.imageUrl || ''))}" alt="" loading="lazy" decoding="async"/><div><div class="n">${escAttr(o.titleAr || o.titleEn || '(بدون عنوان)')}</div><div class="s">${escAttr(o.badge || '')}</div></div></div></td>
              <td>${o.discountPrice != null ? `<span class="price-tag">${escAttr(o.discountPrice)} AED</span>${o.originalPrice != null ? ` <span style="text-decoration:line-through;color:var(--text-dim);font-size:11.5px;">${escAttr(o.originalPrice)}</span>` : ''}` : `<span class="price-tag na">—</span>`}</td>
              <td>${pct != null ? `<span class="badge on">${escAttr(pct)}%</span>` : '—'}</td>
              <td>${o.photoOnly ? '🖼️ صورة فقط' : 'تفاصيل'}</td>
              <td>${o.featured ? '⭐' : '—'}</td>
              <td>${offerStatusBadge(o)}</td>
              <td>
                <div class="row-actions">
                  <button type="button" class="icon-btn edit-offer" data-id="${escAttr(o.id)}">✏️</button>
                  <button type="button" class="icon-btn del del-offer" data-id="${escAttr(o.id)}">🗑</button>
                </div>
              </td>
            </tr>`;
          }).join('') || `<tr class="empty-row"><td colspan="8">مفيش عروض مضافة لسه</td></tr>`}
        </tbody>
      </table>
      </div>
      ${canDrag ? `<div class="drag-hint">🖐 اسحب ⠿ لإعادة ترتيب العروض — الترتيب ده بيتحكم في الكاروسيل في المنيو</div>` : `<div class="drag-hint">امسحي البحث الأول عشان ترتّبي</div>`}
    </div>`;
}

function openOfferDrawer(id) {
  id = id ? String(id).trim() : null;
  const offer = id ? liveState.offers.find(o => String(o.id) === id) : null;
  if (id && !offer) {
    console.error('Offer edit failed: offer id not found in liveState', id, liveState.offers);
    showToast('⚠️ العرض ده مش موجود في البيانات الحالية. حدّث الصفحة وحاول تاني.');
    return;
  }
  pendingImageFile = null;
  openDrawer(offer ? 'تعديل العرض' : 'عرض جديد');
  $('#drawerBody').innerHTML = `
    <div class="field">
      <label>صورة العرض</label>
      <div class="img-upload">
        <img id="dImgPreview" src="${escAttr(offer ? (offer.image || offer.imageUrl || '') : '')}" alt=""/>
        <label>📷 اختار صورة<input type="file" id="dImgInput" accept="image/*" style="display:none;"/></label>
      </div>
    </div>
    <div class="toggle-field field">
      <span style="font-size:13px;font-weight:800;color:var(--text-mid);">صورة فقط — إلغاء كل تفاصيل العرض وعرضه مثل صورة في معرض حلويات غربية</span>
      <label class="toggle"><input type="checkbox" id="dPhotoOnly" ${offer?.photoOnly ? 'checked' : ''}/><span class="track"></span></label>
    </div>
    <div class="offer-photo-only-hint" style="display:none;padding:10px 12px;border-radius:10px;background:var(--green-pale);color:var(--green-deep);font-size:12px;font-weight:700;">🖼️ وضع صورة فقط مفعّل: سيتم حفظ الصورة بدون عنوان أو سعر أو تاريخ أو زر.</div>
    <div class="field-row">
      <div class="field"><label>عنوان العرض (عربي)</label><input id="dTitleAr" value="${escAttr(offer?.titleAr || '')}"/></div>
      <div class="field"><label>عنوان العرض (English)</label><input id="dTitleEn" value="${escAttr(offer?.titleEn || '')}"/></div>
    </div>
    <div class="field-row">
      <div class="field"><label>وصف مختصر (عربي)</label><textarea id="dDescAr" rows="2">${escAttr(offer?.descriptionAr || '')}</textarea></div>
      <div class="field"><label>وصف مختصر (English)</label><textarea id="dDescEn" rows="2">${escAttr(offer?.descriptionEn || '')}</textarea></div>
    </div>
    <div class="field-row">
      <div class="field"><label>السعر الأصلي (AED)</label><input id="dOrigPrice" type="number" value="${offer?.originalPrice ?? ''}"/></div>
      <div class="field"><label>السعر بعد الخصم (AED)</label><input id="dDiscPrice" type="number" value="${offer?.discountPrice ?? ''}"/></div>
    </div>
    <div class="field">
      <label>نسبة الخصم — سيبها فاضية عشان تتحسب أوتوماتيك من السعرين فوق</label>
      <input id="dDiscPct" type="number" min="0" max="100" value="${offer?.discountPercent ?? ''}"/>
    </div>
    <div class="field"><label>نص البادچ (اختياري — زي: خصم 25% / الأكثر طلبًا / لفترة محدودة)</label><input id="dBadge" value="${escAttr(offer?.badge || '')}"/></div>
    <div class="field"><label>نص إضافي صغير (اختياري)</label><input id="dSubText" value="${escAttr(offer?.subText || '')}"/></div>
    <div class="field-row">
      <div class="field"><label>بداية العرض (اختياري)</label><input id="dStartAt" type="datetime-local" value="${offer?.startAt ? toLocalInputValue(offer.startAt) : ''}"/></div>
      <div class="field"><label>نهاية العرض (اختياري)</label><input id="dEndAt" type="datetime-local" value="${offer?.endAt ? toLocalInputValue(offer.endAt) : ''}"/></div>
    </div>
    <div class="toggle-field field">
      <span style="font-size:13px;font-weight:700;color:var(--text-mid);">إظهار عداد تنازلي (لازم يكون فيه تاريخ نهاية)</span>
      <label class="toggle"><input type="checkbox" id="dCountdown" ${offer?.countdownEnabled ? 'checked' : ''}/><span class="track"></span></label>
    </div>
    <div class="toggle-field field">
      <span style="font-size:13px;font-weight:700;color:var(--text-mid);">عرض بكمية محدودة</span>
      <label class="toggle"><input type="checkbox" id="dLimited" ${offer?.limited ? 'checked' : ''}/><span class="track"></span></label>
    </div>
    <div class="field-row">
      <div class="field"><label>نص زرار الدعوة للفعل (CTA) — اختياري</label><input id="dCtaText" value="${escAttr(offer?.ctaText || '')}"/></div>
      <div class="field"><label>رابط الزرار (اختياري — لو موجود بيفتح لينك)</label><input id="dCtaAction" value="${escAttr(offer?.ctaAction || '')}"/></div>
    </div>
    <div class="toggle-field field">
      <span style="font-size:13px;font-weight:700;color:var(--text-mid);">عرض مميّز (يظهر أول واحد في الكاروسيل)</span>
      <label class="toggle"><input type="checkbox" id="dFeatured" ${offer?.featured ? 'checked' : ''}/><span class="track"></span></label>
    </div>
    <div class="toggle-field field">
      <span style="font-size:13px;font-weight:700;color:var(--text-mid);">ظاهر للعملاء</span>
      <label class="toggle"><input type="checkbox" id="dVisible" ${offer ? (offer.visible !== false ? 'checked':'') : 'checked'}/><span class="track"></span></label>
    </div>`;

  $('#dImgInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImageFile = file;
    const oldUrl = $('#dImgPreview').dataset.objectUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    const objectUrl = URL.createObjectURL(file);
    $('#dImgPreview').dataset.objectUrl = objectUrl;
    $('#dImgPreview').src = objectUrl;
  });

  const syncPhotoOnlyFields = () => {
    const photoOnly = $('#dPhotoOnly').checked;
    ['dTitleAr','dTitleEn','dDescAr','dDescEn','dOrigPrice','dDiscPrice','dDiscPct','dBadge','dSubText','dStartAt','dEndAt','dCountdown','dLimited','dCtaText','dCtaAction'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = photoOnly;
    });
    const hint = document.querySelector('#drawerBody .offer-photo-only-hint');
    if (hint) hint.style.display = photoOnly ? 'block' : 'none';
  };
  $('#dPhotoOnly').addEventListener('change', syncPhotoOnlyFields);
  syncPhotoOnlyFields();

  $('#drawerSave').onclick = async () => {
    const titleAr = $('#dTitleAr').value.trim();
    const titleEn = $('#dTitleEn').value.trim();
    const photoOnly = $('#dPhotoOnly').checked;
    if (!photoOnly && !titleAr && !titleEn) {
      showToast('⚠️ حط عنوان العرض بالعربي أو الإنجليزي على الأقل');
      return;
    }

    const countdownChecked = $('#dCountdown').checked;
    const startAtVal = $('#dStartAt').value;
    const endAtVal = $('#dEndAt').value;

    if (countdownChecked && !endAtVal) {
      showToast('⚠️ العداد التنازلي محتاج تاريخ نهاية');
      return;
    }

    const startDate = startAtVal ? new Date(startAtVal) : null;
    const endDate = endAtVal ? new Date(endAtVal) : null;

    if (startDate && isNaN(startDate.getTime())) {
      showToast('⚠️ تاريخ بداية العرض غير صحيح');
      return;
    }

    if (endDate && isNaN(endDate.getTime())) {
      showToast('⚠️ تاريخ نهاية العرض غير صحيح');
      return;
    }

    if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
      showToast('⚠️ تاريخ البداية لازم يكون قبل تاريخ النهاية');
      return;
    }

    const num = (v) => {
      if (v === '' || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const originalPrice = num($('#dOrigPrice').value);
    const discountPrice = num($('#dDiscPrice').value);
    let discountPercent = num($('#dDiscPct').value);

    if (originalPrice != null && originalPrice < 0) {
      showToast('⚠️ السعر الأصلي غير صحيح');
      return;
    }

    if (discountPrice != null && discountPrice < 0) {
      showToast('⚠️ سعر العرض غير صحيح');
      return;
    }

    if (
      discountPercent == null &&
      originalPrice != null &&
      discountPrice != null &&
      originalPrice > 0 &&
      discountPrice <= originalPrice
    ) {
      discountPercent = Math.round(((originalPrice - discountPrice) / originalPrice) * 100);
    }

    if (discountPercent != null && (discountPercent < 0 || discountPercent > 100)) {
      showToast('⚠️ نسبة الخصم لازم تكون بين 0 و100');
      return;
    }

    $('#drawerSave').textContent = 'جاري الحفظ...';
    $('#drawerSave').disabled = true;

    try {
      let image = offer ? (offer.image || offer.imageUrl || '') : '';
      if (!image && !pendingImageFile) {
        showToast('⚠️ لازم تختار صورة للعرض');
        $('#drawerSave').textContent = 'حفظ';
        $('#drawerSave').disabled = false;
        return;
      }

      if (pendingImageFile) {
        const uploaded = await uploadMenuImage(pendingImageFile);
        if (!uploaded || !uploaded.url) {
          throw new Error('رفع الصورة فشل ولم يرجع رابط للصورة');
        }
        image = uploaded.url;
      }

      const data = {
        titleAr: titleAr || '',
        titleEn: titleEn || '',
        descriptionAr: $('#dDescAr').value.trim() || '',
        descriptionEn: $('#dDescEn').value.trim() || '',
        image: image || '',
        originalPrice,
        discountPrice,
        discountPercent,
        badge: $('#dBadge').value.trim() || '',
        subText: $('#dSubText').value.trim() || '',
        startAt: startDate ? startDate.toISOString() : null,
        endAt: endDate ? endDate.toISOString() : null,
        countdownEnabled: !!countdownChecked,
        limited: !!$('#dLimited').checked,
        ctaText: $('#dCtaText').value.trim() || '',
        ctaAction: $('#dCtaAction').value.trim() || '',
        featured: !!$('#dFeatured').checked,
        visible: !!$('#dVisible').checked,
        photoOnly,
      };
      if (photoOnly) {
        // صورة فقط = لا نحمل تفاصيل قديمة للعرض إلى الواجهة بالغلط.
        data.titleAr = '';
        data.titleEn = '';
        data.descriptionAr = '';
        data.descriptionEn = '';
        data.originalPrice = null;
        data.discountPrice = null;
        data.discountPercent = null;
        data.badge = '';
        data.subText = '';
        data.startAt = null;
        data.endAt = null;
        data.countdownEnabled = false;
        data.limited = false;
        data.ctaText = '';
        data.ctaAction = '';
      }

      if (offer) {
        await updateOffer(offer.id, data);
      } else {
        await createOffer({
          ...data,
          displayOrder: liveState.offers.length
        });
      }

      showToast('✅ اتحفظ العرض بنجاح');
      closeDrawer();
      await refreshAndRerender();

    } catch (err) {
      console.error('❌ OFFER SAVE ERROR:', err);
      console.error('code:', err?.code);
      console.error('message:', err?.message);

      let msg = err?.message || err?.code || 'خطأ غير معروف';

      if (err?.code === 'permission-denied') {
        msg = 'Firebase رفض حفظ العرض. تأكد إنك داخل الأدمن وإن صلاحيات Firestore تسمح بالتعديل.';
      } else if (err?.code === 'unauthenticated') {
        msg = 'جلسة الأدمن انتهت. سجل دخول مرة ثانية.';
      }

      showToast(`⚠️ ${msg}`);

    } finally {
      $('#drawerSave').textContent = 'حفظ';
      $('#drawerSave').disabled = false;
    }
  };
}

function toLocalInputValue(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function handleDeleteOffer(id) {
  if (!id) { showToast('⚠️ معرف العرض غير موجود'); return; }
  if (!confirm('تأكيد حذف العرض ده؟')) return;
  try {
    await deleteOffer(id);
    showToast('🗑 اتحذف العرض');
    await refreshAndRerender();
  } catch (err) {
    console.error('DELETE OFFER ERROR:', err);
    showToast(`⚠️ ${err?.message || 'حصل خطأ في حذف العرض'}`);
  }
}

function makeSortableRows(tbody, onReorder) {
  let draggedRow = null;
  tbody.querySelectorAll('tr[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', () => { draggedRow = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      if (!draggedRow) return;
      draggedRow = null;
      const ids = Array.from(tbody.querySelectorAll('tr[data-id]')).map(r => r.dataset.id);
      onReorder(ids);
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedRow || draggedRow === row) return;
      const rect = row.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      row.parentNode.insertBefore(draggedRow, after ? row.nextSibling : row);
    });
  });
}

/* ══════════════════════════════════════
   رتّب الأقسام بالسحب — نفس شكل المنيو بالظبط (home-grid + cat-card)
   بيستخدم نفس الكلاسات اللي المنيو الحقيقي بيستخدمها، عشان الأدمن
   يشوف الشكل الفعلي ويسحب الكروت لمكانها بنفسه، مش جدول.
══════════════════════════════════════ */
function renderVisualReorderGrid() {
  const grid = $('#visualReorderGrid');
  if (!grid) return;
  grid.innerHTML = liveState.categories.map((cat, i) => `
    <div class="cat-card" draggable="true" data-id="${escAttr(cat.id)}">
      <div class="vr-drag-badge">⠿</div>
      <div class="cat-order-num">${i + 1}</div>
      <div class="cat-img-wrap">
        <img class="cat-img" src="${escAttr(cat.imageUrl || '')}" alt="${escAttr(cat.name)}"/>
        <div class="cat-img-overlay"></div>
      </div>
      <div class="cat-body">
        <div class="cat-name">${escAttr(cat.name)}</div>
        <div class="cat-meta"><div class="cat-arrow">←</div><div class="cat-count">${(liveState.products[cat.id] || []).length} صنف</div></div>
      </div>
    </div>`).join('');
  wireVisualReorderDrag(grid);
}

function getVisualDragAfterCard(grid, x, y) {
  const cards = $$('#visualReorderGrid .cat-card:not(.dragging)');
  let closest = { distance: Infinity, element: null };
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    const dx = x - (box.left + box.width / 2);
    const dy = y - (box.top + box.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance < closest.distance) closest = { distance, element: card };
  }
  return closest.element;
}

function renumberVisualCards() {
  $$('#visualReorderGrid .cat-card').forEach((card, i) => {
    const numEl = card.querySelector('.cat-order-num');
    if (numEl) numEl.textContent = i + 1;
  });
}

let visualDraggedCard = null;
function wireVisualReorderDrag(grid) {
  grid.querySelectorAll('.cat-card').forEach(card => {
    card.addEventListener('dragstart', () => {
      visualDraggedCard = card;
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      visualDraggedCard = null;
      renumberVisualCards();
    });
  });
  if (!grid.dataset.dragWired) {
    grid.dataset.dragWired = 'true';
    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!visualDraggedCard) return;
      const afterEl = getVisualDragAfterCard(grid, e.clientX, e.clientY);
      if (afterEl == null) grid.appendChild(visualDraggedCard);
      else if (afterEl !== visualDraggedCard) grid.insertBefore(visualDraggedCard, afterEl);
    });
  }
}

function openVisualReorder() {
  renderVisualReorderGrid();
  $('#visualReorderBackdrop').classList.add('show');
}
function closeVisualReorder() {
  $('#visualReorderBackdrop').classList.remove('show');
}
$('#visualReorderBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'visualReorderBackdrop') closeVisualReorder();
});
$('#vrCancel').addEventListener('click', closeVisualReorder);
$('#vrSave').addEventListener('click', async () => {
  const ids = $$('#visualReorderGrid .cat-card').map(c => c.dataset.id);
  try {
    await reorderCategories(ids);
    showToast('✅ اتغير ترتيب الأقسام');
    closeVisualReorder();
    await refreshAndRerender();
  } catch (err) {
    showToast('⚠️ حصل خطأ في حفظ الترتيب');
  }
});


function heroHexToRgba(hex, opacity) {
  const h = String(hex || '#08100c').replace('#','');
  const full = h.length === 3 ? h.split('').map(x => x + x).join('') : h.padEnd(6,'0').slice(0,6);
  const r = parseInt(full.slice(0,2),16) || 0, g = parseInt(full.slice(2,4),16) || 0, b = parseInt(full.slice(4,6),16) || 0;
  return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,Number(opacity)||0))})`;
}
function heroOverlayCss(o) {
  if (!o?.enabled) return 'transparent';
  const color = heroHexToRgba(o.color, o.opacity);
  const transparent = heroHexToRgba(o.color, 0);
  if (o.type === 'solid') return color;
  if (o.type === 'radial') return `radial-gradient(circle at 50% 50%, ${color} 0%, ${transparent} 100%)`;
  const dir = o.direction || 'to-bottom';
  return `linear-gradient(${dir}, ${transparent} 45%, ${color} 100%)`;
}
function heroPositionPreset(axis, value) {
  if (axis === 'x') return value === 'left' ? 0 : value === 'right' ? 100 : 50;
  return value === 'top' ? 0 : value === 'bottom' ? 100 : 50;
}
function heroPositionLabel(axis, value) {
  if (axis === 'x') return value <= 10 ? 'يسار' : value >= 90 ? 'يمين' : 'منتصف';
  return value <= 10 ? 'أعلى' : value >= 90 ? 'أسفل' : 'منتصف';
}
function heroHeightPreset(v, desktop) {
  const n = Number(v);
  if (desktop) {
    if (n === 340) return 'small'; if (n === 380) return 'medium'; if (n === 440) return 'large';
  } else {
    if (n === 240) return 'small'; if (n === 280) return 'medium'; if (n === 340) return 'large';
  }
  return 'custom';
}

const HERO_IMAGE_SIZE_PRESETS = {
  original: { label: 'الأصلية — بدون قص', width: null, height: null },
  square: { label: '1024 × 1024 — مربع 1:1', width: 1024, height: 1024 },
  landscape32: { label: '1536 × 1024 — أفقي 3:2', width: 1536, height: 1024 },
  portrait23: { label: '1024 × 1536 — رأسي 2:3', width: 1024, height: 1536 },
  landscape43: { label: '1536 × 1152 — أفقي 4:3', width: 1536, height: 1152 },
  portrait34: { label: '1152 × 1536 — رأسي 3:4', width: 1152, height: 1536 },
  landscape54: { label: '1280 × 1024 — أفقي 5:4', width: 1280, height: 1024 },
  portrait45: { label: '1024 × 1280 — رأسي 4:5', width: 1024, height: 1280 },
  landscape169: { label: '1536 × 864 — عريض 16:9', width: 1536, height: 864 },
  portrait916: { label: '864 × 1536 — رأسي 9:16', width: 864, height: 1536 },
  wide21: { label: '1536 × 658 — عريض جدًا 21:9', width: 1536, height: 658 },
  custom: { label: 'مخصص — اكتب العرض والارتفاع', width: null, height: null }
};

/* Display-only thumbnail for admin tables: asks Cloudinary for a small version instead of downloading every
   full-size original. Never written back to the database. Non-Cloudinary URLs are returned unchanged. */
function thumbUrl(url, w = 120) {
  const u = String(url || '');
  const m = '/image/upload/';
  const i = u.indexOf(m);
  if (i === -1 || !u.includes('res.cloudinary.com/')) return u;
  const rest = u.slice(i + m.length);
  if (/^f_auto,q_auto/.test(rest)) return u;
  return u.slice(0, i + m.length) + 'f_auto,q_auto,w_' + w + ',c_limit/' + rest;
}

function heroCloudinarySizedUrl(url, size) {
  if (!url || !size || size.preset === 'original' || !Number(size.width) || !Number(size.height)) return url || '';
  const marker = '/image/upload/';
  if (!url.includes(marker) || !url.includes('res.cloudinary.com/')) return url || '';
  const [base, tail] = url.split(marker);
  const parts = String(tail || '').split('/');
  const knownTransform = /^(?:c_[^/]+|g_[^/]+|w_\d+|h_\d+|q_[^/]+|f_[^/]+|ar_[^/]+|dpr_[^/]+|fl_[^/]+|e_[^/]+|r_[^/]+|bo_[^/]+|b_[^/]+)$/;
  while (parts.length > 1 && knownTransform.test(parts[0])) parts.shift();
  const publicPath = parts.join('/');
  const transform = `c_fill,g_auto,w_${Math.round(size.width)},h_${Math.round(size.height)},q_auto,f_auto`;
  return `${base}${marker}${transform}/${publicPath}`;
}

function heroSizeObjectFromCfg(cfg) {
  const raw = cfg.imageSize || {};
  return {
    preset: raw.preset || 'original',
    width: Number(raw.width) || null,
    height: Number(raw.height) || null
  };
}

function heroSizeLabel(size) {
  if (!size || size.preset === 'original') return 'الأصلية — بدون قص';
  if (size.preset === 'custom') return `${size.width || '—'} × ${size.height || '—'} px`;
  return HERO_IMAGE_SIZE_PRESETS[size.preset]?.label || 'مقاس مخصص';
}

function renderHeroSettings() {
  const cfg = liveState.heroSettings || {};
  heroSavedSnapshot = JSON.parse(JSON.stringify(cfg));
  heroDraftImageOriginalUrl = cfg.imageOriginalUrl || cfg.imageUrl || '';
  heroDraftImageSize = heroSizeObjectFromCfg(cfg);
  heroDraftImageUrl = heroCloudinarySizedUrl(heroDraftImageOriginalUrl, heroDraftImageSize);
  heroDraftImagePublicId = cfg.imagePublicId || '';
  heroDraftLogoUrl = cfg.logo?.url || 'logo-fallback.svg';
  heroDraftLogoPublicId = cfg.logo?.publicId || '';

  const mobileHeight = Number(cfg.heightMobile || 320);
  const desktopHeight = Number(cfg.heightDesktop || 340);
  const x = Number(cfg.backgroundPositionX ?? 50);
  const y = Number(cfg.backgroundPositionY ?? 0);
  const imageFit = ['cover','contain','fill'].includes(cfg.imageFit) ? cfg.imageFit : 'contain';
  const cx = Number(cfg.contentPosition?.x ?? 88);
  const cy = Number(cfg.contentPosition?.y ?? 86);

  const switchHtml = (id, checked) => `<label class="toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}/><span class="track"></span></label>`;
  const range = (id, value, min, max, suffix='%', step=1) => `<div class="hs-range-row"><input class="hs-range" id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/><input class="hs-number" id="${id}Val" type="number" min="${min}" max="${max}" step="${step}" value="${value}"/><span style="display:none" id="${id}Suffix">${suffix}</span></div>`;

  const html = `
    <div class="hero-settings-grid">
      <div class="hero-settings-stack">
        <div class="hero-settings-card">
          <div class="hs-head"><div><h3>Live Preview</h3><p>المعاينة بتتحدث فورًا مع أي تغيير</p></div><span class="badge on">مباشر</span></div>
          <div class="hs-body">
            <div class="hero-preview-wrap">
              <div class="hero-preview" id="heroLivePreview">
                <span class="hs-live-label">Live Preview</span>
                <div class="hero-preview-bg" id="heroPreviewBg"></div>
                <div class="hero-preview-overlay" id="heroPreviewOverlay"></div>
                <div class="hero-preview-glow" id="heroPreviewGlow"></div>
                <div class="hero-preview-content" id="heroPreviewContent">
                  <img class="hero-preview-logo" id="heroPreviewLogo" src="${escAttr(heroDraftLogoUrl)}" alt=""/>
                  <div class="hero-preview-name" id="heroPreviewName"></div>
                  <div class="hero-preview-tagline" id="heroPreviewTagline"></div>
                  <div class="hero-preview-since" id="heroPreviewSince"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="hero-settings-card">
          <div class="hs-head"><div><h3>Appearance</h3><p>الصورة، مكانها، وارتفاع الـ Hero</p></div>${switchHtml('hsEnabled', cfg.enabled !== false)}</div>
          <div class="hs-body">
            <div class="hs-field" style="margin-bottom:16px"><label>Hero Image</label>
              <div class="hs-upload"><img class="hs-upload-thumb" id="heroImageThumb" src="${escAttr(heroDraftImageUrl)}" alt=""/><div class="hs-upload-actions"><label class="btn ghost sm hero-file-label" for="heroImageInput">📷 اختيار / استبدال الصورة</label><button type="button" class="btn ghost sm" id="heroResetImage">↩️ إعادة المحفوظة</button><button type="button" class="btn danger sm" id="heroRemoveImage">🗑 إزالة</button></div><input type="file" id="heroImageInput" accept="image/png,image/jpeg,image/webp,image/gif" class="hero-native-file-input"/></div>
              <div class="hs-help" id="heroImageStatus">${heroDraftImageUrl ? `الصورة الحالية محفوظة — ${heroSizeLabel(heroDraftImageSize)}.` : 'مفيش صورة — هيظهر لون الخلفية الافتراضي.'}</div>
              <div class="hs-field" style="margin-top:14px"><label>مقاس الصورة</label><select id="hsImageSize">${Object.entries(HERO_IMAGE_SIZE_PRESETS).map(([key,item]) => `<option value="${key}" ${heroDraftImageSize.preset===key?'selected':''}>${item.label}</option>`).join('')}</select><div class="hs-help">ChatGPT Images يدعم أي نسبة أبعاد؛ اختر مقاسًا جاهزًا أو Custom. الاختيار هنا يطبّق قصًا متجاوبًا عبر Cloudinary على الصورة المرفوعة.</div></div>
              <div class="hs-control-grid" id="hsImageCustomSize" style="margin-top:12px;display:${heroDraftImageSize.preset==='custom'?'grid':'none'}"><div class="hs-field"><label>العرض (px)</label><input id="hsImageWidth" type="number" min="64" max="4096" value="${heroDraftImageSize.width || 1536}"/></div><div class="hs-field"><label>الارتفاع (px)</label><input id="hsImageHeight" type="number" min="64" max="4096" value="${heroDraftImageSize.height || 864}"/></div></div>
            </div>
            <div class="hs-control-grid" style="margin-top:14px">
              <div class="hs-field"><label>طريقة ملء الصورة</label><select id="hsImageFit"><option value="cover" ${imageFit==='cover'?'selected':''}>Cover — يملأ المساحة (يقص الأطراف)</option><option value="contain" ${imageFit==='contain'?'selected':''}>Contain — الصورة كاملة بدون قص</option><option value="fill" ${imageFit==='fill'?'selected':''}>Fill — يملأ المساحة بدون فراغات</option></select><div class="hs-help">Contain هو الاختيار لو عايز تقفل الـ Cover وتظهر الصورة كاملة. Fill ممكن يمدّ الصورة حسب أبعاد الـHero.</div></div>
              <div class="hs-field"><label>Horizontal Position <span class="hs-value" id="hsXLabel">${heroPositionLabel('x',x)}</span></label>${range('hsX',x,0,100,'%')}</div>
              <div class="hs-field"><label>Vertical Position <span class="hs-value" id="hsYLabel">${heroPositionLabel('y',y)}</span></label>${range('hsY',y,0,100,'%')}</div>
            </div>
            <div class="hs-control-grid" style="margin-top:14px">
              <div class="hs-field"><label>موضع سريع — أفقي</label><div class="hs-segment"><button type="button" data-hero-x="left">يسار</button><button type="button" data-hero-x="center">منتصف</button><button type="button" data-hero-x="right">يمين</button></div></div>
              <div class="hs-field"><label>موضع سريع — رأسي</label><div class="hs-segment"><button type="button" data-hero-y="top">أعلى</button><button type="button" data-hero-y="center">منتصف</button><button type="button" data-hero-y="bottom">أسفل</button></div></div>
            </div>
            <div class="hs-control-grid" style="margin-top:16px">
              <div class="hs-field"><label>ارتفاع الموبايل</label><select id="hsMobilePreset"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="custom">Custom</option></select><input id="hsMobileHeight" type="number" min="180" max="700" value="${mobileHeight}" style="margin-top:7px"/><div class="hs-help">بالبكسل، والـ CSS بيظل responsive.</div></div>
              <div class="hs-field"><label>ارتفاع الديسكتوب</label><select id="hsDesktopPreset"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="custom">Custom</option></select><input id="hsDesktopHeight" type="number" min="260" max="800" value="${desktopHeight}" style="margin-top:7px"/><div class="hs-help">بالبكسل مع الحفاظ على مرونة الشاشات.</div></div>
            </div>
          </div>
        </div>

        <div class="hero-settings-card">
          <div class="hs-head"><div><h3>Overlay</h3><p>الطبقة الداكنة فوق الصورة</p></div></div>
          <div class="hs-body">
            <div class="hs-switch-row"><div><div class="hs-switch-title">Enable Overlay</div><div class="hs-switch-desc">يحافظ على وضوح النص فوق الصورة.</div></div>${switchHtml('hsOverlayEnabled', cfg.overlay?.enabled !== false)}</div>
            <div class="hs-control-grid" style="margin-top:14px">
              <div class="hs-field"><label>Overlay Color</label><input id="hsOverlayColor" type="color" value="${escAttr(cfg.overlay?.color || '#08100c')}"/></div>
              <div class="hs-field"><label>Overlay Type</label><select id="hsOverlayType">
                <option value="linear" ${cfg.overlay?.type === 'linear' || !cfg.overlay?.type ? 'selected' : ''}>Linear</option>
                <option value="radial" ${cfg.overlay?.type === 'radial' ? 'selected' : ''}>Radial</option>
                <option value="solid" ${cfg.overlay?.type === 'solid' ? 'selected' : ''}>Solid</option>
              </select></div>
            </div>
            <div class="hs-field" style="margin-top:14px"><label>Opacity <span class="hs-value" id="hsOverlayOpacityLabel">${Math.round(Number(cfg.overlay?.opacity ?? .55)*100)}%</span></label>${range('hsOverlayOpacity',Math.round(Number(cfg.overlay?.opacity ?? .55)*100),0,100,'%',1)}</div>
            <div class="hs-field" style="margin-top:14px"><label>Direction</label><select id="hsOverlayDirection">
              <option value="to-left" ${cfg.overlay?.direction === 'to-left' ? 'selected' : ''}>Right → Left</option>
              <option value="to-right" ${cfg.overlay?.direction === 'to-right' ? 'selected' : ''}>Left → Right</option>
              <option value="to-bottom" ${cfg.overlay?.direction === 'to-bottom' || !cfg.overlay?.direction ? 'selected' : ''}>Top → Bottom</option>
              <option value="to-top" ${cfg.overlay?.direction === 'to-top' ? 'selected' : ''}>Bottom → Top</option>
            </select></div>
          </div>
        </div>

        <div class="hero-settings-card">
          <div class="hs-head"><div><h3>Content</h3><p>المحتوى النصي الظاهر داخل الـ Hero</p></div></div>
          <div class="hs-body">
            <div class="hs-field"><label>الاسم الرئيسي</label><input id="hsTitle" type="text" maxlength="50" dir="rtl" value="${escAttr(cfg.content?.title || '')}"/><div class="hs-help">يفضل عنوان قصير وواضح.</div></div>
            <div class="hs-field" style="margin-top:14px"><label>Tagline</label><input id="hsTagline" type="text" maxlength="90" dir="ltr" value="${escAttr(cfg.content?.tagline || '')}"/></div>
            <div class="hs-field" style="margin-top:14px"><label>Since</label><input id="hsSince" type="text" maxlength="30" dir="ltr" value="${escAttr(cfg.content?.since || '')}"/></div>
          </div>
        </div>
      </div>

      <div class="hero-settings-stack">
        <div class="hero-settings-card">
          <div class="hs-head"><div><h3>Logo</h3><p>تحكم في ظهور وحجم اللوجو</p></div></div>
          <div class="hs-body">
            <div class="hs-switch-row"><div><div class="hs-switch-title">Show Logo</div><div class="hs-switch-desc">استخدم اللوجو الحالي أو ارفع بديل.</div></div>${switchHtml('hsLogoEnabled', cfg.logo?.enabled !== false)}</div>
            <div class="hs-upload" style="margin-top:14px"><img class="hs-upload-thumb" id="heroLogoThumb" src="${escAttr(heroDraftLogoUrl)}" alt="" style="object-fit:contain;background:#F1EFE8"/><div class="hs-upload-actions"><label class="btn ghost sm hero-file-label" for="heroLogoInput">📷 اختيار / استبدال اللوجو</label><button type="button" class="btn ghost sm" id="heroResetLogo">↩️ إعادة المحفوظ</button></div><input type="file" id="heroLogoInput" accept="image/png,image/jpeg,image/webp,image/gif" class="hero-native-file-input"/></div>
            <div class="hs-field" style="margin-top:16px"><label>Logo Size <span class="hs-value" id="hsLogoSizeLabel">${Number(cfg.logo?.size || 108)}px</span></label>${range('hsLogoSize',Number(cfg.logo?.size || 108),40,180,'px')}</div>
          </div>
        </div>

        <div class="hero-settings-card">
          <div class="hs-head"><div><h3>Content Position</h3><p>موضع المحتوى مع إمكانية التحكم الدقيق</p></div></div>
          <div class="hs-body">
            <div class="hs-control-grid">
              <div class="hs-field"><label>Horizontal</label><select id="hsContentH"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="custom">Custom</option></select></div>
              <div class="hs-field"><label>Vertical</label><select id="hsContentV"><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option><option value="custom">Custom</option></select></div>
            </div>
            <div class="hs-field" style="margin-top:14px"><label>X Position <span class="hs-value" id="hsContentXLabel">${cx}%</span></label>${range('hsContentX',cx,0,100,'%')}</div>
            <div class="hs-field" style="margin-top:12px"><label>Y Position <span class="hs-value" id="hsContentYLabel">${cy}%</span></label>${range('hsContentY',cy,0,100,'%')}</div>
          </div>
        </div>

        <div class="hero-settings-card">
          <div class="hs-head"><div><h3>Typography</h3><p>أحجام آمنة مع الحفاظ على الخطوط الحالية</p></div></div>
          <div class="hs-body">
            <div class="hs-field"><label>Title Size <span class="hs-value" id="hsTitleSizeLabel">${Number(cfg.typography?.titleSize || 62)}px</span></label>${range('hsTitleSize',Number(cfg.typography?.titleSize || 62),34,86,'px')}</div>
            <div class="hs-field" style="margin-top:14px"><label>Tagline Size <span class="hs-value" id="hsTaglineSizeLabel">${Number(cfg.typography?.taglineSize || 15)}px</span></label>${range('hsTaglineSize',Number(cfg.typography?.taglineSize || 15),10,24,'px')}</div>
            <div class="hs-field" style="margin-top:14px"><label>Since Size <span class="hs-value" id="hsSinceSizeLabel">${Number(cfg.typography?.sinceSize || 12)}px</span></label>${range('hsSinceSize',Number(cfg.typography?.sinceSize || 12),9,18,'px')}</div>
          </div>
        </div>

        <div class="hero-settings-card">
          <div class="hs-head"><div><h3>Animation</h3><p>نفس الحركة الخفيفة بدون مكتبات إضافية</p></div></div>
          <div class="hs-body">
            <div class="hs-switch-row"><div><div class="hs-switch-title">Hero Image Zoom</div><div class="hs-switch-desc">تكبير هادئ للصورة عند ظهورها.</div></div>${switchHtml('hsAnimZoom', cfg.animation?.imageZoom !== false)}</div>
            <div class="hs-switch-row"><div><div class="hs-switch-title">Green Glow</div><div class="hs-switch-desc">وهج أخضر متحرك خفيف.</div></div>${switchHtml('hsAnimGlow', cfg.animation?.glow !== false)}</div>
            <div class="hs-switch-row"><div><div class="hs-switch-title">Content Entrance</div><div class="hs-switch-desc">دخول المحتوى بانسيابية.</div></div>${switchHtml('hsAnimContent', cfg.animation?.contentReveal !== false)}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="hs-footer">
      <div class="hs-status"><span class="hs-status-dot"></span> أي تعديل هنا مجرد معاينة لحد ما تضغط حفظ</div>
      <button type="button" class="btn ghost" id="heroResetBtn">↩️ Reset</button>
      <button type="button" class="btn gold" id="heroSaveBtn">💾 Save Changes</button>
    </div>`;
  return html;
}

async function heroMakeSizedPreview(file, size) {
  if (!file) return '';
  const sourceUrl = URL.createObjectURL(file);
  let keepSourceUrl = false;
  try {
    // Keep the source object URL alive when the original image is requested.
    if (!size || size.preset === 'original' || !Number(size.width) || !Number(size.height)) {
      keepSourceUrl = true;
      return sourceUrl;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = sourceUrl;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    const tw = Math.max(1, Math.round(Number(size.width)));
    const th = Math.max(1, Math.round(Number(size.height)));
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('المتصفح لا يدعم تجهيز الصورة بالمقاس المطلوب');
    const scale = Math.max(tw / img.naturalWidth, th / img.naturalHeight);
    const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
    ctx.drawImage(img, (tw-sw)/2, (th-sh)/2, sw, sh);
    const isPng = String(file.type || '').toLowerCase() === 'image/png';
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('تعذر تجهيز الصورة بالمقاس المطلوب')), mime, isPng ? undefined : 0.92));
    return URL.createObjectURL(blob);
  } finally {
    if (!keepSourceUrl) URL.revokeObjectURL(sourceUrl);
  }
}

async function heroPrepareUploadFile(file, size) {
  if (!file) return null;
  if (!size || size.preset === 'original' || !Number(size.width) || !Number(size.height)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async'; img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    const tw = Math.max(1, Math.round(Number(size.width)));
    const th = Math.max(1, Math.round(Number(size.height)));
    const canvas = document.createElement('canvas'); canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('المتصفح لا يدعم تجهيز الصورة بالمقاس المطلوب');
    const scale = Math.max(tw / img.naturalWidth, th / img.naturalHeight);
    const sw = img.naturalWidth * scale, sh = img.naturalHeight * scale;
    ctx.drawImage(img, (tw-sw)/2, (th-sh)/2, sw, sh);
    const isPng = String(file.type || '').toLowerCase() === 'image/png';
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const ext = isPng ? 'png' : 'jpg';
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('تعذر تجهيز الصورة بالمقاس المطلوب')), mime, isPng ? undefined : 0.92));
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '-hero.' + ext, { type:mime, lastModified:Date.now() });
  } finally { URL.revokeObjectURL(url); }
}

function setHeroStatus(text, tone='') {
  const el = $('#heroImageStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = tone === 'error' ? 'var(--red)' : tone === 'ok' ? 'var(--green-d)' : tone === 'wait' ? 'var(--gold)' : '';
}

function wireHeroSettingsControls() {
  const preview = $('#heroLivePreview');
  const setRangePair = (id, labelId, suffix='') => {
    const r = $('#'+id), n = $('#'+id+'Val'), l = $('#'+labelId);
    if (!r || !n) return;
    const sync = (source) => { const val = Number(source.value); r.value = val; n.value = val; if (l) l.textContent = val + suffix; updateHeroPreview(); };
    r.addEventListener('input', () => sync(r)); n.addEventListener('input', () => sync(n));
  };

  function readHeroPreviewState() {
    return {
      enabled: $('#hsEnabled')?.checked !== false,
      imageUrl: heroDraftImageUrl,
      x: Number($('#hsX')?.value ?? 50), y: Number($('#hsY')?.value ?? 0),
      imageFit: ['cover','contain','fill'].includes($('#hsImageFit')?.value) ? $('#hsImageFit').value : 'cover',
      mobileHeight: Number($('#hsMobileHeight')?.value || 320), desktopHeight: Number($('#hsDesktopHeight')?.value || 340),
      overlay: { enabled: $('#hsOverlayEnabled')?.checked !== false, color: $('#hsOverlayColor')?.value || '#08100c', opacity: Number($('#hsOverlayOpacity')?.value || 55)/100, type: $('#hsOverlayType')?.value || 'linear', direction: $('#hsOverlayDirection')?.value || 'to-bottom' },
      title: $('#hsTitle')?.value || '', tagline: $('#hsTagline')?.value || '', since: $('#hsSince')?.value || '',
      logo: { enabled: $('#hsLogoEnabled')?.checked !== false, url: heroDraftLogoUrl, size: Number($('#hsLogoSize')?.value || 108) },
      cx: Number($('#hsContentX')?.value ?? 88), cy: Number($('#hsContentY')?.value ?? 86),
      titleSize: Number($('#hsTitleSize')?.value || 62), taglineSize: Number($('#hsTaglineSize')?.value || 15), sinceSize: Number($('#hsSinceSize')?.value || 12),
      zoom: $('#hsAnimZoom')?.checked !== false, glow: $('#hsAnimGlow')?.checked !== false, contentAnim: $('#hsAnimContent')?.checked !== false
    };
  }
  function updateHeroPreview() {
    if (!preview) return;
    const v = readHeroPreviewState();
    preview.style.setProperty('--preview-mobile-h', `${Math.min(v.mobileHeight, 600)}px`);
    preview.style.setProperty('--preview-desktop-h', `${Math.min(v.desktopHeight, 700)}px`);
    preview.style.display = v.enabled ? 'block' : 'none';
    const bg = $('#heroPreviewBg'), ov = $('#heroPreviewOverlay'), glow = $('#heroPreviewGlow'), content = $('#heroPreviewContent');
    if (!bg) return;
    bg.style.backgroundImage = v.imageUrl ? `url(${JSON.stringify(String(v.imageUrl))})` : 'none';
    bg.style.backgroundPosition = `${v.x}% ${v.y}%`;
    bg.style.backgroundColor = '#0D3622';
    bg.style.backgroundSize = v.imageFit === 'fill' ? '100% 100%' : v.imageFit;
    // Preview follows the same strict Zoom ON/OFF behavior as the live Hero.
    bg.style.transform = v.zoom ? 'scale(1.02)' : 'none';
    bg.style.animation = v.zoom ? '' : 'none';
    bg.style.willChange = v.zoom ? 'transform' : 'auto';
    ov.style.background = heroOverlayCss(v.overlay);
    glow.style.display = v.glow ? 'block' : 'none';
    content.style.left = `${v.cx}%`; content.style.top = `${v.cy}%`; content.style.transform = 'translate(-50%,-50%)';
    content.style.opacity = v.contentAnim ? '1' : '1';
    const logo = $('#heroPreviewLogo'); logo.style.display = v.logo.enabled && v.logo.url ? 'block' : 'none'; logo.src = v.logo.url || 'logo-fallback.svg'; logo.style.width = `${v.logo.size}px`; logo.style.height = `${v.logo.size}px`;
    $('#heroPreviewName').textContent = v.title; $('#heroPreviewName').style.fontSize = `${v.titleSize}px`;
    $('#heroPreviewTagline').textContent = v.tagline; $('#heroPreviewTagline').style.fontSize = `${v.taglineSize}px`;
    $('#heroPreviewSince').textContent = v.since; $('#heroPreviewSince').style.fontSize = `${v.sinceSize}px`;
    if (!v.title) $('#heroPreviewName').style.display='none'; else $('#heroPreviewName').style.display='block';
    if (!v.tagline) $('#heroPreviewTagline').style.display='none'; else $('#heroPreviewTagline').style.display='block';
    if (!v.since) $('#heroPreviewSince').style.display='none'; else $('#heroPreviewSince').style.display='flex';
  }

  setRangePair('hsX','hsXLabel','%'); setRangePair('hsY','hsYLabel','%');
  setRangePair('hsOverlayOpacity','hsOverlayOpacityLabel','%'); setRangePair('hsLogoSize','hsLogoSizeLabel','px');
  setRangePair('hsContentX','hsContentXLabel','%'); setRangePair('hsContentY','hsContentYLabel','%');
  setRangePair('hsTitleSize','hsTitleSizeLabel','px'); setRangePair('hsTaglineSize','hsTaglineSizeLabel','px'); setRangePair('hsSinceSize','hsSinceSizeLabel','px');

  const wireSimplePreview = ['hsEnabled','hsImageFit','hsOverlayEnabled','hsOverlayColor','hsOverlayType','hsOverlayDirection','hsLogoEnabled','hsAnimZoom','hsAnimGlow','hsAnimContent','hsTitle','hsTagline','hsSince','hsMobileHeight','hsDesktopHeight'];
  wireSimplePreview.forEach(id => { const el=$('#'+id); el?.addEventListener(el.type === 'range' ? 'input' : 'input', updateHeroPreview); el?.addEventListener('change', updateHeroPreview); });

  $$('.hs-segment button[data-hero-x]').forEach(btn => btn.addEventListener('click', () => { const val=heroPositionPreset('x',btn.dataset.heroX); $('#hsX').value=val; $('#hsXVal').value=val; updateHeroPreview(); }));
  $$('.hs-segment button[data-hero-y]').forEach(btn => btn.addEventListener('click', () => { const val=heroPositionPreset('y',btn.dataset.heroY); $('#hsY').value=val; $('#hsYVal').value=val; updateHeroPreview(); }));

  const setPreset = (selId,inputId,desktop) => { const sel=$('#'+selId), input=$('#'+inputId); const vals=desktop?{small:340,medium:380,large:440}:{small:220,medium:270,large:320}; sel.value=heroHeightPreset(Number(input.value),desktop); sel.addEventListener('change',()=>{if(sel.value!=='custom'){input.value=vals[sel.value];} updateHeroPreview();}); input.addEventListener('input',()=>{sel.value='custom';updateHeroPreview();}); };
  setPreset('hsMobilePreset','hsMobileHeight',false); setPreset('hsDesktopPreset','hsDesktopHeight',true);

  const setContentPreset = (selId, axis) => { const sel=$('#'+selId); const input=$('#'+(axis==='x'?'hsContentX':'hsContentY')); const vals=axis==='x'?{left:12,center:50,right:88}:{top:14,center:50,bottom:86}; const current=Number(input?.value ?? (axis==='x'?88:86)); sel.value = (axis==='x' ? (current>=80?'right':current<=20?'left':'custom') : (current>=80?'bottom':current<=20?'top':'custom')); sel.addEventListener('change',()=>{ if(sel.value!=='custom'){input.value=vals[sel.value]; input.dispatchEvent(new Event('input',{bubbles:true}));} }); };
  setContentPreset('hsContentH','x'); setContentPreset('hsContentV','y');

  $('#heroImageInput')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setHeroStatus('⚠️ الملف لازم يكون صورة.', 'error'); e.target.value=''; return; }
    if (file.size > 15 * 1024 * 1024) { setHeroStatus('⚠️ حجم الصورة أكبر من 15MB.', 'error'); e.target.value=''; return; }
    heroPendingImageFile = file;
    heroPendingImageToken++;
    const token = heroPendingImageToken;
    if (heroPendingImageObjectUrl) URL.revokeObjectURL(heroPendingImageObjectUrl);
    heroPendingImageObjectUrl = URL.createObjectURL(file);
    $('#heroImageThumb').src = heroPendingImageObjectUrl;
    heroDraftImageUrl = heroPendingImageObjectUrl;
    heroDraftImageOriginalUrl = '';
    heroDraftImagePublicId = '';
    setHeroStatus(`✅ تم اختيار الصورة: ${file.name} — لم تُرفع بعد. اضغط Save Changes للحفظ.`, 'ok');
    updateHeroPreview();
    try {
      const sized = await heroMakeSizedPreview(file, heroDraftImageSize);
      if (token !== heroPendingImageToken) { if (sized) URL.revokeObjectURL(sized); return; }
      if (sized) {
        if (heroPendingImageObjectUrl) URL.revokeObjectURL(heroPendingImageObjectUrl);
        heroPendingImageObjectUrl = sized;
        heroDraftImageUrl = sized;
        $('#heroImageThumb').src = sized;
        updateHeroPreview();
      }
    } catch (_) {}
    e.target.value = '';
  });

  $('#hsImageSize')?.addEventListener('change', async () => {
    const preset = $('#hsImageSize').value;
    const custom = $('#hsImageCustomSize');
    if (custom) custom.style.display = preset === 'custom' ? 'grid' : 'none';
    const presetData = HERO_IMAGE_SIZE_PRESETS[preset] || HERO_IMAGE_SIZE_PRESETS.original;
    heroDraftImageSize = {
      preset,
      width: preset === 'custom' ? Math.max(64, Math.min(4096, Math.round(Number($('#hsImageWidth')?.value || 1536)))) : presetData.width,
      height: preset === 'custom' ? Math.max(64, Math.min(4096, Math.round(Number($('#hsImageHeight')?.value || 864)))) : presetData.height
    };
    if (preset === 'custom') {
      if ($('#hsImageWidth')) $('#hsImageWidth').value = heroDraftImageSize.width;
      if ($('#hsImageHeight')) $('#hsImageHeight').value = heroDraftImageSize.height;
    }
    if (heroPendingImageFile) {
      const token = ++heroPendingImageToken;
      try {
        const sized = await heroMakeSizedPreview(heroPendingImageFile, heroDraftImageSize);
        if (token !== heroPendingImageToken) { if (sized) URL.revokeObjectURL(sized); return; }
        if (heroPendingImageObjectUrl) URL.revokeObjectURL(heroPendingImageObjectUrl);
        heroPendingImageObjectUrl = sized;
        heroDraftImageUrl = sized;
        $('#heroImageThumb').src = sized || '';
      } catch (_) {}
    } else {
      const source = heroDraftImageOriginalUrl || heroDraftImageUrl;
      heroDraftImageUrl = heroCloudinarySizedUrl(source, heroDraftImageSize);
      $('#heroImageThumb').src = heroDraftImageUrl || '';
    }
    setHeroStatus(heroDraftImageUrl ? `المقاس: ${heroSizeLabel(heroDraftImageSize)} — اضغط Save Changes للحفظ.` : `تم اختيار ${heroSizeLabel(heroDraftImageSize)} — اختر صورة أولًا.`, heroDraftImageUrl ? 'ok' : '');
    updateHeroPreview();
  });
  ['hsImageWidth','hsImageHeight'].forEach(id => $('#'+id)?.addEventListener('input', async () => {
    if ($('#hsImageSize')?.value !== 'custom') return;
    const width = Math.max(64, Math.min(4096, Math.round(Number($('#hsImageWidth').value || 1536))));
    const height = Math.max(64, Math.min(4096, Math.round(Number($('#hsImageHeight').value || 864))));
    if ($('#hsImageWidth')) $('#hsImageWidth').value = width;
    if ($('#hsImageHeight')) $('#hsImageHeight').value = height;
    heroDraftImageSize = { preset:'custom', width, height };
    if (heroPendingImageFile) {
      const token = ++heroPendingImageToken;
      try {
        const sized = await heroMakeSizedPreview(heroPendingImageFile, heroDraftImageSize);
        if (token !== heroPendingImageToken) { if (sized) URL.revokeObjectURL(sized); return; }
        if (heroPendingImageObjectUrl) URL.revokeObjectURL(heroPendingImageObjectUrl);
        heroPendingImageObjectUrl = sized; heroDraftImageUrl = sized;
      } catch (err) {
        if (token !== heroPendingImageToken) return;
        console.warn('Hero custom preview failed:', err);
        setHeroStatus('تعذر تجهيز المعاينة بالمقاس المخصص. جرّب مقاسًا أصغر.', 'error');
      }
    } else {
      heroDraftImageUrl = heroCloudinarySizedUrl(heroDraftImageOriginalUrl || heroDraftImageUrl, heroDraftImageSize);
    }
    $('#heroImageThumb').src = heroDraftImageUrl || '';
    setHeroStatus(`المقاس: ${heroSizeLabel(heroDraftImageSize)} — اضغط Save Changes للحفظ.`, heroDraftImageUrl ? 'ok' : '');
    updateHeroPreview();
  }));

  $('#heroRemoveImage')?.addEventListener('click',()=>{
    heroPendingImageFile=null; heroPendingImageToken++;
    if(heroPendingImageObjectUrl){URL.revokeObjectURL(heroPendingImageObjectUrl);heroPendingImageObjectUrl='';}
    heroDraftImageUrl='';heroDraftImageOriginalUrl='';heroDraftImagePublicId='';
    $('#heroImageThumb').src=''; setHeroStatus('تمت إزالة الصورة من المعاينة — اضغط Save Changes لتأكيدها.'); updateHeroPreview();
  });
  $('#heroResetImage')?.addEventListener('click',()=>{
    const saved = heroSavedSnapshot;
    heroPendingImageFile=null; heroPendingImageToken++;
    if(heroPendingImageObjectUrl){URL.revokeObjectURL(heroPendingImageObjectUrl);heroPendingImageObjectUrl='';}
    heroDraftImageOriginalUrl = saved.imageOriginalUrl || saved.imageUrl || '';
    heroDraftImageSize = heroSizeObjectFromCfg(saved);
    heroDraftImageUrl = heroCloudinarySizedUrl(heroDraftImageOriginalUrl, heroDraftImageSize);
    heroDraftImagePublicId = saved.imagePublicId || '';
    if ($('#hsImageSize')) $('#hsImageSize').value = heroDraftImageSize.preset;
    if ($('#hsImageCustomSize')) $('#hsImageCustomSize').style.display = heroDraftImageSize.preset === 'custom' ? 'grid' : 'none';
    if ($('#hsImageWidth')) $('#hsImageWidth').value = heroDraftImageSize.width || 1536;
    if ($('#hsImageHeight')) $('#hsImageHeight').value = heroDraftImageSize.height || 864;
    $('#heroImageThumb').src=heroDraftImageUrl; setHeroStatus(heroDraftImageUrl?`تمت إعادة الصورة المحفوظة — ${heroSizeLabel(heroDraftImageSize)}.`:'لا توجد صورة محفوظة.'); updateHeroPreview();
  });

  $('#heroLogoInput')?.addEventListener('change', async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    if (!file.type.startsWith('image/')) { showToast('⚠️ الملف لازم يكون صورة'); e.target.value=''; return; }
    if (file.size > 15 * 1024 * 1024) { showToast('⚠️ حجم اللوجو أكبر من 15MB'); e.target.value=''; return; }
    heroPendingLogoFile=file;
    if(heroPendingLogoObjectUrl) URL.revokeObjectURL(heroPendingLogoObjectUrl);
    heroPendingLogoObjectUrl=URL.createObjectURL(file);
    heroDraftLogoUrl=heroPendingLogoObjectUrl; heroDraftLogoPublicId='';
    $('#heroLogoThumb').src=heroDraftLogoUrl; updateHeroPreview();
    showToast('✅ تم اختيار اللوجو — اضغط Save Changes للحفظ'); e.target.value='';
  });
  $('#heroResetLogo')?.addEventListener('click',()=>{
    heroPendingLogoFile=null;
    if(heroPendingLogoObjectUrl){URL.revokeObjectURL(heroPendingLogoObjectUrl);heroPendingLogoObjectUrl='';}
    heroDraftLogoUrl=heroSavedSnapshot.logo?.url||'logo-fallback.svg';heroDraftLogoPublicId=heroSavedSnapshot.logo?.publicId||'';$('#heroLogoThumb').src=heroDraftLogoUrl;updateHeroPreview();
  });

  $('#heroResetBtn')?.addEventListener('click',()=>{ if(confirm('ترجيع كل الإعدادات لآخر نسخة محفوظة؟')) render(); });
  $('#heroSaveBtn')?.addEventListener('click',async()=>{
    const btn=$('#heroSaveBtn');
    if (!btn) return;
    btn.textContent='⏳ جاري الحفظ...'; btn.disabled=true;
    try{
      const v=readHeroPreviewState();
      const cleanSize = {
        preset: heroDraftImageSize?.preset || 'original',
        width: Number(heroDraftImageSize?.width) || null,
        height: Number(heroDraftImageSize?.height) || null
      };
      if (heroPendingImageFile) {
        setHeroStatus(`⏳ جاري تجهيز الصورة بمقاس ${heroSizeLabel(cleanSize)} ثم رفعها...`, 'wait');
        const uploadFile = await heroPrepareUploadFile(heroPendingImageFile, cleanSize);
        const uploaded = await uploadMenuImage(uploadFile);
        if (!uploaded?.url) throw new Error('رفع صورة Hero لم يُرجع رابطًا');
        heroDraftImageOriginalUrl = uploaded.url;
        heroDraftImageUrl = uploaded.url;
        heroDraftImagePublicId = uploaded.publicId || '';
      }
      if (heroPendingLogoFile) {
        const uploadedLogo = await uploadMenuImage(heroPendingLogoFile);
        if (!uploadedLogo?.url) throw new Error('رفع اللوجو لم يُرجع رابطًا');
        heroDraftLogoUrl = uploadedLogo.url;
        heroDraftLogoPublicId = uploadedLogo.publicId || '';
      }
      const next={
        ...homeNonFormKeys(),   // slider / promo banner / drawer links live in the same document — keep them when the Hero form saves
        enabled:v.enabled,
        imageUrl:heroDraftImageUrl || '',
        imageOriginalUrl:heroDraftImageOriginalUrl || heroDraftImageUrl || '',
        imagePublicId:heroDraftImagePublicId || '',
        imageSize:cleanSize,
        imageFit:v.imageFit,
        backgroundPositionX:v.x,
        backgroundPositionY:v.y,
        heightMobile:v.mobileHeight,
        heightDesktop:v.desktopHeight,
        overlay:v.overlay,
        content:{title:v.title,tagline:v.tagline,since:v.since},
        logo:{enabled:v.logo.enabled,url:heroDraftLogoUrl || '',publicId:heroDraftLogoPublicId || '',size:v.logo.size},
        contentPosition:{horizontal:$('#hsContentH')?.value||'right',vertical:$('#hsContentV')?.value||'bottom',x:v.cx,y:v.cy},
        typography:{titleSize:v.titleSize,taglineSize:v.taglineSize,sinceSize:v.sinceSize},
        animation:{imageZoom:v.zoom,glow:v.glow,contentReveal:v.contentAnim}
      };
      const saved = await saveHeroSettings(next);
      const committed = saved || next;
      liveState.heroSettings = committed;
      // Keep Reset Image / Reset Logo anchored to the newly saved state.
      // Otherwise, after a successful save, Reset could unexpectedly restore
      // the state from before that save.
      heroSavedSnapshot = JSON.parse(JSON.stringify(committed));
      heroDraftImageOriginalUrl = committed.imageOriginalUrl || committed.imageUrl || '';
      heroDraftImageUrl = committed.imageUrl || '';
      heroDraftImagePublicId = committed.imagePublicId || '';
      heroDraftImageSize = heroSizeObjectFromCfg(committed);
      heroDraftLogoUrl = committed.logo?.url || 'logo-fallback.svg';
      heroDraftLogoPublicId = committed.logo?.publicId || '';
      heroPendingImageFile = null; heroPendingLogoFile = null;
      if (heroPendingImageObjectUrl) { URL.revokeObjectURL(heroPendingImageObjectUrl); heroPendingImageObjectUrl=''; }
      if (heroPendingLogoObjectUrl) { URL.revokeObjectURL(heroPendingLogoObjectUrl); heroPendingLogoObjectUrl=''; }
      window.dispatchEvent(new CustomEvent('hero-settings-updated'));
      const status=$('#heroImageStatus');
      if(status) status.textContent = heroDraftImageUrl ? `تم الحفظ فعليًا — ${heroSizeLabel(cleanSize)}.` : 'تم الحفظ بدون صورة Hero.';
      showToast('✅ تم حفظ إعدادات الـ Hero فعليًا');
      btn.textContent='✅ تم الحفظ';
      setTimeout(()=>{ if(btn) btn.textContent='💾 Save Changes'; },1200);
    }catch(err){
      console.error('HERO SAVE ERROR',err);
      let msg=err?.message||err?.code||'حصل خطأ في الحفظ';
      if(err?.code==='permission-denied') msg='Firebase رفض الكتابة على siteSettings/hero. لازم Rules تسمح للأدمن بالكتابة.';
      else if(err?.code==='unauthenticated') msg='جلسة الأدمن انتهت. سجّل الدخول مرة ثانية.';
      showToast('⚠️ '+msg);
      btn.textContent='💾 Save Changes';
    }finally{ btn.disabled=false; }
  });
  updateHeroPreview();
}


function wireContentEvents() {
  $$('.settings-card').forEach(btn => btn.addEventListener('click', () => {
    resetHomeDrafts();
    settingsSection = btn.dataset.settingsSection;
    render();
  }));
  $('#settingsBackBtn')?.addEventListener('click', () => { resetHomeDrafts(); settingsSection='hub'; render(); });
  $('#refreshMediaBtn')?.addEventListener('click', () => renderContentOnly());
  $$('.media-copy').forEach(btn => btn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(btn.dataset.url || ''); showToast('✅ اتنسخ رابط الصورة'); } catch { showToast('⚠️ المتصفح منع النسخ التلقائي'); } }));
  $('#exportBackupBtn')?.addEventListener('click', async () => {
    const btn=$('#exportBackupBtn'); btn.disabled=true; btn.textContent='⏳ جاري تجهيز النسخة...';
    try { const data=await exportSiteBackup(); const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='anwar-lebanon-backup-'+new Date().toISOString().slice(0,10)+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); showToast('✅ اتصدرت النسخة الاحتياطية'); } catch(e){showToast('⚠️ '+(e?.message||'فشل التصدير'));} finally{btn.disabled=false;btn.textContent='⬇️ تصدير نسخة احتياطية';}
  });
  $('#importBackupInput')?.addEventListener('change', async e => {
    const file=e.target.files?.[0]; e.target.value=''; if(!file) return;
    if(file.size > 20 * 1024 * 1024) { showToast('⚠️ ملف النسخة الاحتياطية كبير جدًا (أقصى حد 20MB)'); return; }
    if(!confirm('متأكد؟ الاستعادة هتستبدل الأقسام والأصناف والعروض الحالية.')) return;
    try { const text=await file.text(); const data=JSON.parse(text); showToast('⏳ جاري استعادة النسخة...'); await importSiteBackup(data); showToast('✅ تمت الاستعادة — جاري تحديث البيانات'); await refreshAndRerender(); } catch(err){console.error(err);showToast('⚠️ '+(err?.message||'فشلت الاستعادة'));}
  });
  if (currentView === 'hero' || (currentView === 'siteSettings' && settingsSection === 'hero')) wireHeroSettingsControls();
  if (currentView === 'siteSettings') { if (settingsSection === 'slider') wireSliderSettings(); else if (settingsSection === 'promo') wirePromoSettings(); else if (settingsSection === 'drawer') wireDrawerSettings(); else if (settingsSection === 'pages') wirePagesSettings(); }
  $('#addCatBtn')?.addEventListener('click', () => openCategoryDrawer(null));
  $('#visualReorderBtn')?.addEventListener('click', () => openVisualReorder());
  $$('.edit-cat').forEach(b => b.addEventListener('click', () => openCategoryDrawer(b.dataset.id)));
  $$('.del-cat').forEach(b => b.addEventListener('click', () => handleDeleteCategory(b.dataset.id)));

  $('#addProdBtn')?.addEventListener('click', () => openProductDrawer(null));
  $('#addProdBulkBtn')?.addEventListener('click', () => openBulkImageDrawer());
  $$('.edit-prod').forEach(b => b.addEventListener('click', () => openProductDrawer(b.dataset.id)));
  $$('.del-prod').forEach(b => b.addEventListener('click', () => handleDeleteProduct(b.dataset.id)));

  $$('.chip-filter').forEach(b => b.addEventListener('click', () => {
    productCatFilter = b.dataset.cat;
    renderContentOnly();
  }));

  const catsTbody = $('#catsTbody');
  if (catsTbody) makeSortableRows(catsTbody, async (ids) => {
    try { await reorderCategories(ids); showToast('✅ اتغير ترتيب الأقسام'); await refreshAndRerender(); }
    catch (err) { showToast('⚠️ حصل خطأ في حفظ الترتيب'); }
  });

  const prodsTbody = $('#prodsTbody');
  if (prodsTbody) makeSortableRows(prodsTbody, async (ids) => {
    try { await reorderProducts(ids); showToast('✅ اتغير ترتيب الأصناف'); await refreshAndRerender(); }
    catch (err) { showToast('⚠️ حصل خطأ في حفظ الترتيب'); }
  });

  $('#offersBackBtn')?.addEventListener('click', () => { currentView = 'overview'; $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === 'overview')); render(); });
  $('#westernBackBtn')?.addEventListener('click', () => { currentView = 'overview'; $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === 'overview')); render(); });
  $('#createOffersCatBtn')?.addEventListener('click', () => handleCreateOffersCategory());
  $('#editOffersCatBtn')?.addEventListener('click', () => {
    const cat = findOffersCategory();
    if (cat) openCategoryDrawer(cat.id);
  });
  $('#addOfferBtn')?.addEventListener('click', () => openOfferDrawer(null));
  $$('.edit-offer').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openOfferDrawer(String(b.dataset.id || '').trim()); }));
  $$('.del-offer').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handleDeleteOffer(String(b.dataset.id || '').trim()); }));

  $('#westernAddImagesBtn')?.addEventListener('click', () => $('#westernImagesInput')?.click());
  $('#westernImagesInput')?.addEventListener('change', e => {
    addWesternGalleryImages(Array.from(e.target.files || []));
    e.target.value = '';
  });
  $('#westernReplaceInput')?.addEventListener('change', e => {
    const index = Number(e.target.dataset.index);
    const file = e.target.files?.[0];
    if (file) replaceWesternGalleryImage(index, file);
    e.target.value = '';
  });
  $('#westernEditCatBtn')?.addEventListener('click', () => {
    const cat = findWesternGalleryCategory();
    if (cat) openCategoryDrawer(cat.id);
  });
  $$('.western-edit-image').forEach(btn => btn.addEventListener('click', () => {
    const input = $('#westernReplaceInput');
    if (!input) return;
    input.dataset.index = btn.dataset.index;
    input.click();
  }));
  $$('.western-del-image').forEach(btn => btn.addEventListener('click', async () => {
    const cat = findWesternGalleryCategory();
    const images = Array.isArray(cat?.galleryImages) ? [...cat.galleryImages] : [];
    const index = Number(btn.dataset.index);
    if (!images[index]) return;
    if (!confirm('تأكيد حذف الصورة دي من المعرض؟')) return;
    images.splice(index, 1);
    try {
      await updateCategory(cat.id, { galleryImages: images });
      showToast('🗑 اتحذفت الصورة');
      await refreshAndRerender();
    } catch (err) {
      console.error(err);
      showToast(`⚠️ ${err?.message || 'حصل خطأ في حذف الصورة'}`);
    }
  }));
  wireWesternGalleryDrag();

  const offersTbody = $('#offersTbody');
  if (offersTbody) makeSortableRows(offersTbody, async (ids) => {
    try { await reorderOffers(ids); showToast('✅ اتغير ترتيب العروض'); await refreshAndRerender(); }
    catch (err) { showToast('⚠️ حصل خطأ في حفظ الترتيب'); }
  });
}

async function refreshAndRerender() {
  await fetchMenuData();
  renderContentOnly();
}

/* ── delete handlers ── */
async function handleDeleteCategory(id) {
  if (!confirm('تأكيد حذف القسم ده وكل أصنافه؟')) return;
  const items = liveState.products[id] || [];
  for (const it of items) await deleteProduct(it.id);
  await deleteCategory(id);
  showToast('🗑 اتحذف القسم');
  await refreshAndRerender();
}
async function handleDeleteProduct(id) {
  if (!confirm('تأكيد حذف الصنف؟')) return;
  await deleteProduct(id);
  showToast('🗑 اتحذف الصنف');
  await refreshAndRerender();
}

/* ── drawer ── */
const backdrop = $('#drawerBackdrop');
$('#drawerClose').onclick = closeDrawer;
$('#drawerCancel').onclick = closeDrawer;
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDrawer(); });
function closeDrawer() { backdrop.classList.remove('show'); }
function openDrawer(title) { $('#drawerTitle').textContent = title; backdrop.classList.add('show'); }

let pendingImageFile = null;
let pendingBannerImageFile = null;
let bannerCleared = false;

/* ── توليد معرف بسيط للأقسام الفرعية/أحجام الأسعار ── */
function makeLocalId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function openCategoryDrawer(id) {
  const cat = id ? liveState.categories.find(c => c.id === id) : null;
  pendingImageFile = null;
  pendingBannerImageFile = null;
  bannerCleared = false;
  let pendingSections = cat && cat.sections ? cat.sections.map(s => ({ ...s })) : [];
  openDrawer(cat ? 'تعديل القسم' : 'قسم جديد');
  $('#drawerBody').innerHTML = `
    <div class="field">
      <label>صورة القسم من الخارج</label>
      <div class="field-hint" style="margin:-2px 0 10px;">دي اللي بتظهر في كارت القسم بالصفحة الرئيسية.</div>
      <div class="img-upload">
        <img id="dImgPreview" src="${escAttr(cat ? cat.imageUrl : '')}" alt=""/>
        <label>📷 اختار صورة<input type="file" id="dImgInput" accept="image/*" style="display:none;"/></label>
      </div>
    </div>
    <div class="field">
      <label>صورة القسم من الداخل</label>
      <div class="field-hint" style="margin:-2px 0 10px;">دي اللي بتظهر فوق لما تفتحي القسم. المقاس المثالي: Widescreen 16:9 (مثلاً 1600×900 px) — أصغر مقاس ينفع تصمم بيه، وأي صورة غيره هتتقص تلقائي تطلع بنفس النسبة دي. اختياري — لو سيبتها فاضية هيستخدم نفس صورة الخارج.</div>
      <div class="img-upload banner-upload">
        <img id="dBannerImgPreview" src="${escAttr(cat ? (cat.bannerImageUrl || cat.imageUrl || '') : '')}" alt=""/>
        <label>📷 اختار صورة<input type="file" id="dBannerImgInput" accept="image/*" style="display:none;"/></label>
      </div>
      ${cat && cat.bannerImageUrl ? `<button class="btn ghost sm" id="dBannerClearBtn" type="button" style="margin-top:8px;">↩️ رجّع لنفس صورة الخارج</button>` : ''}
    </div>
    <div class="field"><label>اسم القسم</label><input id="dName" value="${escAttr(cat?.name || '')}"/></div>
    <div class="toggle-field field">
      <span style="font-size:13px;font-weight:700;color:var(--text-mid);">ظاهر في المنيو</span>
      <label class="toggle"><input type="checkbox" id="dVisible" ${cat ? (cat.visible ? 'checked':'') : 'checked'}/><span class="track"></span></label>
    </div>
    <div class="field">
      <label>أقسام فرعية (اختياري)</label>
      <div class="field-hint" style="margin:-2px 0 10px;">لو القسم كبير وعايز تقسمه لأقسام جوا بعض (زي: فطاير أجبان، فطاير لحوم...)، ضيفهم هنا. لما يكون فيه أقسام فرعية، هيظهر شريط تابز في صفحة القسم في الموقع.</div>
      <div id="sectionsList"></div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input id="newSectionName" placeholder="اسم القسم الفرعي..."
          style="flex:1; padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; font-size:13.5px; background:#FBFAF7;"/>
        <button class="btn ghost sm" id="addSectionBtn" type="button">+ إضافة</button>
      </div>
    </div>`;

  function renderSectionsList() {
    const list = $('#sectionsList');
    if (!pendingSections.length) {
      list.innerHTML = `<div class="field-hint">مفيش أقسام فرعية دلوقتي</div>`;
      return;
    }
    list.innerHTML = pendingSections.map((s, i) => `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <input data-idx="${i}" class="sec-name-input" value="${escAttr(s.name)}"
          style="flex:1; padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; font-size:13.5px; background:#FBFAF7;"/>
        <button class="icon-btn del sec-remove-btn" data-idx="${i}" type="button">🗑</button>
      </div>`).join('');
    list.querySelectorAll('.sec-name-input').forEach(inp => {
      inp.addEventListener('input', (e) => { pendingSections[+e.target.dataset.idx].name = e.target.value; });
    });
    list.querySelectorAll('.sec-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => { pendingSections.splice(+btn.dataset.idx, 1); renderSectionsList(); });
    });
  }
  renderSectionsList();

  $('#addSectionBtn').addEventListener('click', () => {
    const name = $('#newSectionName').value.trim();
    if (!name) { showToast('⚠️ حط اسم القسم الفرعي الأول'); return; }
    pendingSections.push({ id: makeLocalId(), name });
    $('#newSectionName').value = '';
    renderSectionsList();
  });

  $('#dImgInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImageFile = file;
    $('#dImgPreview').src = URL.createObjectURL(file);
  });

  $('#dBannerImgInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingBannerImageFile = file;
    bannerCleared = false;
    $('#dBannerImgPreview').src = URL.createObjectURL(file);
  });

  $('#dBannerClearBtn')?.addEventListener('click', () => {
    bannerCleared = true;
    pendingBannerImageFile = null;
    $('#dBannerImgPreview').src = $('#dImgPreview').src;
  });

  $('#drawerSave').onclick = async () => {
    const name = $('#dName').value.trim();
    if (!name) { showToast('⚠️ حط اسم القسم'); return; }
    const cleanSections = pendingSections.filter(s => s.name.trim())
      .map(s => ({ id: s.id, name: s.name.trim() }));
    $('#drawerSave').textContent = 'جاري الحفظ...';
    try {
      let imageUrl = cat ? cat.imageUrl : '';
      if (pendingImageFile) {
        const { url } = await uploadMenuImage(pendingImageFile);
        imageUrl = url;
      }
      let bannerImageUrl = cat ? (cat.bannerImageUrl || '') : '';
      if (bannerCleared) {
        bannerImageUrl = '';
      } else if (pendingBannerImageFile) {
        const { url } = await uploadMenuImage(pendingBannerImageFile);
        bannerImageUrl = url;
      }
      const data = { name, imageUrl, bannerImageUrl, visible: $('#dVisible').checked, sections: cleanSections };
      if (cat) await updateCategory(cat.id, data);
      else await createCategory({ ...data, displayType: 'category', menuImageUrl: '', tag: '', emoji: '', displayOrder: liveState.categories.length });
      showToast('✅ اتحفظ');
      closeDrawer();
      await refreshAndRerender();
    } catch (err) {
      showToast('⚠️ حصل خطأ، حاول تاني');
    } finally {
      $('#drawerSave').textContent = 'حفظ';
    }
  };
}

/* ── تحويل نص مفصول بفواصل لمصفوفة نظيفة (للأحجام/النكهات/أنواع المناقيش) ── */
function parseCsvList(str) {
  return String(str || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function openProductDrawer(id) {
  const item = id ? allProductsFlat().find(p => p.id === id) : null;
  pendingImageFile = null;
  let pendingSizePrices = item && item.sizePrices ? item.sizePrices.map(s => ({ ...s })) : [];
  const catOptions = liveState.categories.map(c => `<option value="${escAttr(c.id)}" ${item && item.categoryId===c.id ? 'selected':''}>${escAttr(c.name)}</option>`).join('');
  openDrawer(item ? 'تعديل الصنف' : 'صنف جديد');
  $('#drawerBody').innerHTML = `
    <div class="field">
      <label>صورة الصنف</label>
      <div class="img-upload">
        <img id="dImgPreview" src="${escAttr(item ? item.imageUrl : '')}" alt=""/>
        <label>📷 اختار صورة<input type="file" id="dImgInput" accept="image/*" style="display:none;"/></label>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>القسم</label><select id="dCat" style="width:100%;padding:11px 13px;border:1.5px solid var(--line);border-radius:10px;font-size:13.5px;background:#FBFAF7;">${catOptions}</select></div>
      <div class="field" id="dSectionWrap" style="display:none;"><label>القسم الفرعي</label><select id="dSection" style="width:100%;padding:11px 13px;border:1.5px solid var(--line);border-radius:10px;font-size:13.5px;background:#FBFAF7;"></select></div>
    </div>
    <div class="field"><label>اسم الصنف (اختياري لو مفعّلة "صورة بس" تحت)</label><input id="dName" value="${escAttr(item?.name || '')}"/></div>
    <div class="field-row">
      <div class="field"><label>السعر (AED) — سيبه فاضي لو هتستخدمي أحجام وأسعار تحت</label><input id="dPrice" type="number" value="${item && !(item.sizePrices && item.sizePrices.length) ? (item.price ?? '') : ''}"/></div>
      <div class="field"><label>التقييم (0-5)</label><input id="dRating" type="number" min="0" max="5" step="0.1" value="${item?.rating ?? ''}"/></div>
    </div>
    <div class="field">
      <label>أحجام وأسعار (اختياري — زي: وسط/كبير)</label>
      <div id="sizePricesList"></div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input id="newSizeName" placeholder="اسم الحجم (وسط...)"
          style="flex:1; padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; font-size:13.5px; background:#FBFAF7;"/>
        <input id="newSizePrice" type="number" placeholder="السعر"
          style="width:100px; padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; font-size:13.5px; background:#FBFAF7;"/>
        <button class="btn ghost sm" id="addSizePriceBtn" type="button">+ إضافة</button>
      </div>
      <div class="field-hint">لو ضفتي حجم هنا، السعر المفرد فوق هيتجاهل والمنيو هيعرض الأحجام دي بدل منه.</div>
    </div>
    <div class="field"><label>الأحجام (اختياري — مفصولة بفاصلة، زي: صغير, كبير)</label><input id="dSizes" value="${escAttr((item?.sizes || []).join(', '))}"/></div>
    <div class="field"><label>النكهات (اختياري — مفصولة بفاصلة)</label><input id="dFlavors" value="${escAttr((item?.flavors || []).join(', '))}"/></div>
    <div class="field"><label>أنواع المناقيش (اختياري — مفصولة بفاصلة)</label><input id="dManaesh" value="${escAttr((item?.manaeshTypes || []).join(', '))}"/></div>
    <div class="field"><label>الوصف</label><textarea id="dDesc" rows="3">${escAttr(item?.description || '')}</textarea></div>
    <div class="field">
      <label>القيمة الغذائية</label>
      <div class="field-row">
        <input id="dCal" type="number" placeholder="سعرات" value="${item?.nutrition?.calories ?? ''}"/>
        <input id="dProt" type="number" placeholder="بروتين g" value="${item?.nutrition?.protein ?? ''}"/>
        <input id="dFat" type="number" placeholder="دهون g" value="${item?.nutrition?.fat ?? ''}"/>
        <input id="dCarb" type="number" placeholder="كارب g" value="${item?.nutrition?.carb ?? ''}"/>
      </div>
      <div class="field-hint">سيبها فاضية لو مش هتظهر في صفحة الصنف</div>
    </div>
    <div class="field-row">
      <div class="toggle-field field"><span style="font-size:13px;font-weight:700;color:var(--text-mid);">عرض واسع (wide)</span><label class="toggle"><input type="checkbox" id="dWide" ${item?.wide ? 'checked' : ''}/><span class="track"></span></label></div>
      <div class="toggle-field field"><span style="font-size:13px;font-weight:700;color:var(--text-mid);">عرض طويل (tall)</span><label class="toggle"><input type="checkbox" id="dTall" ${item?.tall ? 'checked' : ''}/><span class="track"></span></label></div>
    </div>
    <div class="toggle-field field">
      <span style="font-size:13px;font-weight:700;color:var(--text-mid);">صورة بس (من غير اسم أو سعر يظهر للعميل)</span>
      <label class="toggle"><input type="checkbox" id="dHideInfo" ${item?.hideInfo ? 'checked' : ''}/><span class="track"></span></label>
    </div>
    <div class="field-hint" style="margin-top:-10px;">ممكن تسيب الاسم فاضي، وهتتعرف عليه في الجدول بالصورة المصغّرة بس — العميل مش هيشوف غير الصورة.</div>
    <div class="toggle-field field">
      <span style="font-size:13px;font-weight:700;color:var(--text-mid);">ظاهر في المنيو</span>
      <label class="toggle"><input type="checkbox" id="dVisible" ${item ? (item.visible?'checked':'') : 'checked'}/><span class="track"></span></label>
    </div>`;

  function renderSizePricesList() {
    const list = $('#sizePricesList');
    if (!pendingSizePrices.length) {
      list.innerHTML = `<div class="field-hint">مفيش أحجام مضافة دلوقتي</div>`;
      return;
    }
    list.innerHTML = pendingSizePrices.map((s, i) => `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <input data-idx="${i}" class="sz-name-input" value="${escAttr(s.name)}" placeholder="اسم الحجم"
          style="flex:1; padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; font-size:13.5px; background:#FBFAF7;"/>
        <input data-idx="${i}" type="number" class="sz-price-input" value="${escAttr(s.price)}" placeholder="السعر"
          style="width:100px; padding:11px 13px; border:1.5px solid var(--line); border-radius:10px; font-size:13.5px; background:#FBFAF7;"/>
        <button class="icon-btn del sz-remove-btn" data-idx="${i}" type="button">🗑</button>
      </div>`).join('');
    list.querySelectorAll('.sz-name-input').forEach(inp => {
      inp.addEventListener('input', (e) => { pendingSizePrices[+e.target.dataset.idx].name = e.target.value; });
    });
    list.querySelectorAll('.sz-price-input').forEach(inp => {
      inp.addEventListener('input', (e) => { pendingSizePrices[+e.target.dataset.idx].price = Number(e.target.value) || 0; });
    });
    list.querySelectorAll('.sz-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => { pendingSizePrices.splice(+btn.dataset.idx, 1); renderSizePricesList(); });
    });
  }
  renderSizePricesList();

  $('#addSizePriceBtn').addEventListener('click', () => {
    const name = $('#newSizeName').value.trim();
    const price = Number($('#newSizePrice').value) || 0;
    if (!name) { showToast('⚠️ حط اسم الحجم الأول'); return; }
    pendingSizePrices.push({ name, price });
    $('#newSizeName').value = '';
    $('#newSizePrice').value = '';
    renderSizePricesList();
  });

  function refreshSectionDropdown(selectedCatId, selectedSectionId) {
    const cat = liveState.categories.find(c => c.id === selectedCatId);
    const wrap = $('#dSectionWrap');
    const sel = $('#dSection');
    if (cat && cat.sections && cat.sections.length) {
      sel.innerHTML = `<option value="">بدون قسم فرعي</option>` +
        cat.sections.map(s => `<option value="${escAttr(s.id)}" ${s.id === selectedSectionId ? 'selected' : ''}>${escAttr(s.name)}</option>`).join('');
      wrap.style.display = 'block';
    } else {
      sel.innerHTML = '';
      wrap.style.display = 'none';
    }
  }
  refreshSectionDropdown($('#dCat').value, item?.sectionId || '');
  $('#dCat').addEventListener('change', (e) => refreshSectionDropdown(e.target.value, ''));

  $('#dImgInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImageFile = file;
    $('#dImgPreview').src = URL.createObjectURL(file);
  });

  $('#drawerSave').onclick = async () => {
    const name = $('#dName').value.trim();
    const categoryId = $('#dCat').value;
    const hideInfoChecked = $('#dHideInfo').checked;
    if (!name && !hideInfoChecked) { showToast('⚠️ حط اسم الصنف'); return; }
    if (!categoryId) { showToast('⚠️ اختار قسم'); return; }
    $('#drawerSave').textContent = 'جاري الحفظ...';
    try {
      let imageUrl = item ? item.imageUrl : '';
      if (pendingImageFile) {
        const { url } = await uploadMenuImage(pendingImageFile);
        imageUrl = url;
      }
      const num = (v) => v === '' ? null : Number(v);
      const cleanSizePrices = pendingSizePrices.filter(s => s.name && s.name.trim());
      const sectionEl = $('#dSection');
      const sectionId = (sectionEl && sectionEl.value) ? sectionEl.value : null;
      const data = {
        name, categoryId, imageUrl,
        sectionId,
        price: cleanSizePrices.length ? null : num($('#dPrice').value),
        sizePrices: cleanSizePrices,
        sizes: parseCsvList($('#dSizes').value),
        flavors: parseCsvList($('#dFlavors').value),
        manaeshTypes: parseCsvList($('#dManaesh').value),
        rating: num($('#dRating').value),
        description: $('#dDesc').value.trim(),
        nutrition: { calories: num($('#dCal').value), protein: num($('#dProt').value), fat: num($('#dFat').value), carb: num($('#dCarb').value) },
        wide: $('#dWide').checked,
        tall: $('#dTall').checked,
        hideInfo: $('#dHideInfo').checked,
        visible: $('#dVisible').checked,
      };
      if (item) await updateProduct(item.id, data);
      else await createProduct({ ...data, displayOrder: (liveState.products[categoryId]||[]).length });
      showToast('✅ اتحفظ');
      closeDrawer();
      await refreshAndRerender();
    } catch (err) {
      showToast('⚠️ حصل خطأ، حاول تاني');
    } finally {
      $('#drawerSave').textContent = 'حفظ';
    }
  };
}

function openBulkImageDrawer() {
  let pendingFiles = [];
  const catOptions = liveState.categories.map(c => `<option value="${escAttr(c.id)}">${escAttr(c.name)}</option>`).join('');
  openDrawer('إضافة أصناف بالصور (دفعة واحدة)');
  $('#drawerBody').innerHTML = `
    <div class="field-hint" style="margin-bottom:6px;">هيتضاف صنف "صورة بس" لكل صورة — من غير اسم أو سعر. تقدري تعدّلي أي صنف بعدين لو حبيتي.</div>
    <div class="field-row">
      <div class="field"><label>القسم</label><select id="bCat" style="width:100%;padding:11px 13px;border:1.5px solid var(--line);border-radius:10px;font-size:13.5px;background:#FBFAF7;">${catOptions}</select></div>
      <div class="field" id="bSectionWrap" style="display:none;"><label>القسم الفرعي</label><select id="bSection" style="width:100%;padding:11px 13px;border:1.5px solid var(--line);border-radius:10px;font-size:13.5px;background:#FBFAF7;"></select></div>
    </div>
    <div class="field">
      <label>الصور</label>
      <div class="img-upload">
        <label>📷 اختار كذا صورة<input type="file" id="bImgInput" accept="image/*" multiple style="display:none;"/></label>
      </div>
      <div id="bPreviewGrid" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;"></div>
    </div>`;

  function refreshSectionDropdown(selectedCatId) {
    const cat = liveState.categories.find(c => c.id === selectedCatId);
    const wrap = $('#bSectionWrap'), sel = $('#bSection');
    if (cat && cat.sections && cat.sections.length) {
      sel.innerHTML = `<option value="">بدون قسم فرعي</option>` +
        cat.sections.map(s => `<option value="${escAttr(s.id)}">${escAttr(s.name)}</option>`).join('');
      wrap.style.display = 'block';
    } else { sel.innerHTML = ''; wrap.style.display = 'none'; }
  }
  refreshSectionDropdown($('#bCat').value);
  $('#bCat').addEventListener('change', (e) => refreshSectionDropdown(e.target.value));

  function renderPreviewGrid() {
    const grid = $('#bPreviewGrid');
    grid.innerHTML = pendingFiles.map((f, i) => `
      <div style="position:relative; width:72px; height:72px;">
        <img src="${escAttr(f.previewUrl)}" style="width:100%; height:100%; object-fit:cover; border-radius:8px; border:1.5px solid var(--line);"/>
        <button type="button" class="bimg-remove" data-idx="${i}" style="position:absolute; top:-6px; left:-6px; width:20px; height:20px; border-radius:50%; background:var(--red); color:#fff; font-size:11px; line-height:20px; text-align:center;">✕</button>
      </div>`).join('');
    grid.querySelectorAll('.bimg-remove').forEach(btn => {
      btn.addEventListener('click', () => { pendingFiles.splice(+btn.dataset.idx, 1); renderPreviewGrid(); });
    });
  }

  $('#bImgInput').addEventListener('change', (e) => {
    Array.from(e.target.files || []).forEach(file => pendingFiles.push({ file, previewUrl: URL.createObjectURL(file) }));
    e.target.value = '';
    renderPreviewGrid();
  });

  $('#drawerSave').onclick = async () => {
    const categoryId = $('#bCat').value;
    if (!categoryId) { showToast('⚠️ اختار قسم'); return; }
    if (!pendingFiles.length) { showToast('⚠️ اختار صورة واحدة على الأقل'); return; }
    const sectionEl = $('#bSection');
    const sectionId = (sectionEl && sectionEl.value) ? sectionEl.value : null;
    const startOrder = (liveState.products[categoryId] || []).length;
    let done = 0;
    $('#drawerSave').textContent = `جاري الحفظ... (0/${pendingFiles.length})`;
    try {
      for (const f of pendingFiles) {
        const { url } = await uploadMenuImage(f.file);
        await createProduct({
          name: '', categoryId, sectionId, imageUrl: url,
          price: null, sizePrices: [], sizes: [], flavors: [], manaeshTypes: [],
          rating: null, description: '',
          nutrition: { calories: null, protein: null, fat: null, carb: null },
          wide: false, tall: false, hideInfo: true, visible: true,
          displayOrder: startOrder + done,
        });
        done++;
        $('#drawerSave').textContent = `جاري الحفظ... (${done}/${pendingFiles.length})`;
      }
      showToast(`✅ اتضاف ${done} صنف`);
      closeDrawer();
      await refreshAndRerender();
    } catch (err) {
      showToast(`⚠️ حصل خطأ بعد ما اتضاف ${done} من ${pendingFiles.length}`);
      closeDrawer();
      await refreshAndRerender();
    } finally {
      $('#drawerSave').textContent = 'حفظ';
    }
  };
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js', {scope:'./'}).catch(err => console.warn('PWA service worker unavailable:', err)));
}


/* ══════════════════════════════════════
   الصفحة الرئيسية — سلايدر الهيرو / البانر الترويجي / روابط القائمة الجانبية
   كلها بتتخزن في نفس مستند siteSettings/hero (من غير collections جديدة) وبنفس صلاحيات الأدمن.
══════════════════════════════════════ */
let hsDraft = null, promoDraft = null, dlDraft = null, hs2PrevIdx = 0;
const HS_MAX_SLIDES = 12;
const HS_RATIOS = [['16/9', '16:9 عريض'], ['3/2', '3:2'], ['4/3', '4:3'], ['21/9', '21:9 سينمائي'], ['1/1', '1:1 مربع']];
function resetHomeDrafts() { hsDraft = promoDraft = dlDraft = null; hs2PrevIdx = 0; pagesDraft = null; }
function homeNonFormKeys() {
  const c = liveState.heroSettings || {};
  return { slides: c.slides || [], sliderInterval: c.sliderInterval, sliderRatio: c.sliderRatio, sliderFit: c.sliderFit, promoBanner: c.promoBanner, drawerLinks: c.drawerLinks };
}
function settingsTitleOf(sec) {
  return ({ hero: 'واجهة الـ Hero', slider: 'سلايدر الصور (Hero)', promo: 'البانر الترويجي للرئيسية', drawer: 'روابط القائمة الجانبية', pages: 'صفحات الموقع (الفروع / الكيترنج / تابعنا)', seo: 'SEO وبيانات الموقع' })[sec] || 'النسخ الاحتياطي';
}
const homeSwitch = (id, on) => `<label class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}/><span class="track"></span></label>`;
const homeClone = (o) => JSON.parse(JSON.stringify(o));
const homeNewId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const homeUrlOk = (u, rel) => !u || /^https?:\/\//i.test(u) || (rel && /^(\.\/|\/(?!\/)|#)/.test(u));
function homeSaveError(err) {
  console.error('HOME SETTINGS SAVE ERROR', err);
  let msg = err?.message || err?.code || 'حصل خطأ في الحفظ';
  if (err?.code === 'permission-denied') msg = 'Firebase رفض الكتابة على siteSettings/hero. لازم Rules تسمح للأدمن بالكتابة.';
  else if (err?.code === 'unauthenticated') msg = 'جلسة الأدمن انتهت. سجّل الدخول مرة ثانية.';
  showToast('⚠️ ' + msg);
}
async function homeCommit(next, okMsg) {
  const saved = await saveHeroSettings(next);
  liveState.heroSettings = saved || next;
  window.dispatchEvent(new CustomEvent('hero-settings-updated'));
  showToast(okMsg);
}

/* ── سلايدر الصور ── */
function renderSliderSettings() {
  const c = liveState.heroSettings || {};
  if (!hsDraft) hsDraft = { slides: homeClone(c.slides || []), interval: c.sliderInterval || 5, ratio: c.sliderRatio || '16/9', fit: c.sliderFit || 'cover' };
  return `<div class="hero-settings-stack hs2">
    <div class="hero-settings-card"><div class="hs-head"><div><h3>معاينة قبل النشر</h3><p>بتعرض الصور المفعّلة بترتيبها الحالي. التغييرات مش بتظهر للزوار إلا بعد «حفظ ونشر».</p></div><span class="badge on" id="hs2Count"></span></div><div class="hs-body"><div id="hs2Preview"></div></div></div>
    <div class="hero-settings-card"><div class="hs-head"><div><h3>الصور</h3><p>اسحب المقبض ⠿ أو استخدم ▲ ▼ لإعادة الترتيب — أقصى عدد ${HS_MAX_SLIDES} صورة.</p></div></div><div class="hs-body">
      <div id="hs2List" class="hs2-list"></div>
      <div class="hs2-add"><label class="btn gold sm" for="hs2AddInput">＋ إضافة صور</label><input id="hs2AddInput" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple hidden/>
        <div class="hs2-bar" id="hs2Bar" hidden><i></i></div><div class="hs-help" id="hs2Status">لو مفيش صور مفعّلة، الصفحة الرئيسية بتعرض صورة الـ Hero الأصلية.</div></div>
    </div></div>
    <div class="hero-settings-card"><div class="hs-head"><div><h3>إعدادات العرض</h3></div></div><div class="hs-body"><div class="hs-control-grid">
      <div class="hs-field"><label>مدة الصورة (بالثواني)</label><input type="number" id="hs2Interval" min="2" max="20" step="1" value="${Number(hsDraft.interval)}"/></div>
      <div class="hs-field"><label>نسبة أبعاد السلايدر</label><select id="hs2Ratio">${HS_RATIOS.map(([v, l]) => `<option value="${v}" ${hsDraft.ratio === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="hs-field"><label>ضبط الصورة</label><select id="hs2Fit"><option value="cover" ${hsDraft.fit !== 'contain' ? 'selected' : ''}>ملء المساحة (قد يقص الأطراف)</option><option value="contain" ${hsDraft.fit === 'contain' ? 'selected' : ''}>الصورة كاملة بدون قص</option></select></div>
    </div></div></div>
    <div class="hs2-actions"><button type="button" class="btn ghost" id="hs2Reset">↩️ تراجع عن التعديلات</button><button type="button" class="btn gold" id="hs2Save">💾 حفظ ونشر</button></div>
  </div>`;
}
function hs2ItemHtml(s, i, n) {
  return `<div class="hs2-item${s.enabled === false ? ' off' : ''}" data-i="${i}" data-id="${escAttr(s.id)}">
    <div class="hs2-grip" data-grip title="اسحب لإعادة الترتيب">⠿</div>
    <div class="hs2-thumb-wrap"><img class="hs2-thumb" src="${escAttr(s.imageUrl)}" alt=""/><span class="hs2-num">${i + 1}</span></div>
    <div class="hs2-fields">
      <div class="hs-field"><label>العنوان (اختياري)</label><input type="text" data-f="title" maxlength="80" value="${escAttr(s.title)}"/></div>
      <div class="hs-field"><label>النص الفرعي (اختياري)</label><input type="text" data-f="subtitle" maxlength="160" value="${escAttr(s.subtitle)}"/></div>
      <div class="hs-control-grid"><div class="hs-field"><label>نص الزر (اختياري)</label><input type="text" data-f="buttonLabel" maxlength="30" value="${escAttr(s.buttonLabel)}"/></div>
        <div class="hs-field"><label>رابط الزر</label><input type="text" dir="ltr" inputmode="url" data-f="buttonUrl" placeholder="https://..." value="${escAttr(s.buttonUrl)}"/></div></div>
    </div>
    <div class="hs2-side">
      <label class="toggle" title="تفعيل / تعطيل"><input type="checkbox" data-f="enabled" ${s.enabled === false ? '' : 'checked'}/><span class="track"></span></label>
      <div class="hs2-btns"><button type="button" class="btn ghost sm" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="تحريك لأعلى">▲</button><button type="button" class="btn ghost sm" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="تحريك لأسفل">▼</button></div>
      <label class="btn ghost sm" for="hs2Rep${i}">🔄 استبدال</label><input id="hs2Rep${i}" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" data-replace="${i}" hidden/>
      <button type="button" class="btn danger sm" data-act="del">🗑 حذف</button>
    </div></div>`;
}
function hs2RenderList() {
  const list = $('#hs2List'); if (!list || !hsDraft) return;
  const n = hsDraft.slides.length;
  list.innerHTML = n ? hsDraft.slides.map((s, i) => hs2ItemHtml(s, i, n)).join('') : '<div class="hs-help" style="padding:10px 2px">لسه مفيش صور. اضغط «إضافة صور» لرفع أول صورة.</div>';
  hs2RenderPreview();
}
function hs2RenderPreview() {
  const box = $('#hs2Preview'); if (!box || !hsDraft) return;
  const act = hsDraft.slides.filter(s => s.enabled !== false && s.imageUrl);
  const cnt = $('#hs2Count'); if (cnt) cnt.textContent = `${act.length} مفعّلة من ${hsDraft.slides.length}`;
  if (!act.length) { box.innerHTML = '<div class="hs2-pv-empty">مفيش صور مفعّلة — الصفحة الرئيسية هتعرض صورة الـ Hero الأصلية.</div>'; return; }
  hs2PrevIdx = Math.min(hs2PrevIdx, act.length - 1);
  const s = act[hs2PrevIdx];
  box.innerHTML = `<div class="hs2-pv" style="aspect-ratio:${escAttr(hsDraft.ratio.replace('/', ' / '))}"><img src="${escAttr(s.imageUrl)}" alt="" style="object-fit:${hsDraft.fit === 'contain' ? 'contain' : 'cover'}"/>
    ${(s.title || s.subtitle || s.buttonLabel) ? `<div class="hs2-pv-cap">${s.title ? `<b>${escAttr(s.title)}</b>` : ''}${s.subtitle ? `<span>${escAttr(s.subtitle)}</span>` : ''}${s.buttonLabel ? `<em>${escAttr(s.buttonLabel)}</em>` : ''}</div>` : ''}
    ${act.length > 1 ? `<div class="hs2-pv-dots">${act.map((_, k) => `<button type="button" data-pv="${k}" class="${k === hs2PrevIdx ? 'on' : ''}" aria-label="${k + 1}"></button>`).join('')}</div>` : ''}</div>`;
}
async function hs2UploadFiles(files, replaceIndex) {
  const status = $('#hs2Status'), bar = $('#hs2Bar');
  const list = Array.from(files || []); let ok = 0;
  if (bar) bar.hidden = false;
  for (let k = 0; k < list.length; k++) {
    if (replaceIndex == null && hsDraft.slides.length >= HS_MAX_SLIDES) { showToast(`⚠️ أقصى عدد ${HS_MAX_SLIDES} صورة`); break; }
    if (status) status.textContent = `⏳ جاري رفع الصورة ${k + 1} من ${list.length}…`;
    if (bar) bar.firstElementChild.style.width = Math.max(8, Math.round((k / list.length) * 100)) + '%';
    try {
      const r = await uploadMenuImage(list[k]);
      if (!r?.url) throw new Error('رفع الصورة فشل');
      if (replaceIndex != null && hsDraft.slides[replaceIndex]) Object.assign(hsDraft.slides[replaceIndex], { imageUrl: r.url, imagePublicId: r.publicId || '' });
      else hsDraft.slides.push({ id: homeNewId(), imageUrl: r.url, imagePublicId: r.publicId || '', title: '', subtitle: '', buttonLabel: '', buttonUrl: '', enabled: true });
      ok++; hs2RenderList();
    } catch (err) { console.error('slide upload', err); showToast('⚠️ ' + (err?.message || 'فشل رفع الصورة')); }
  }
  if (bar) { bar.firstElementChild.style.width = '100%'; setTimeout(() => { bar.hidden = true; bar.firstElementChild.style.width = '0'; }, 500); }
  if (status) status.textContent = ok ? `✅ تم رفع ${ok} صورة — لسه ما اتنشرتش، اضغط «حفظ ونشر».` : (status.textContent.startsWith('⏳') ? 'ما تمش رفع أي صورة.' : status.textContent);
}
async function hs2Save() {
  const btn = $('#hs2Save'); if (!btn || !hsDraft) return;
  const interval = Number($('#hs2Interval')?.value);
  if (!(interval >= 2 && interval <= 20)) { showToast('⚠️ مدة الصورة لازم تكون بين 2 و 20 ثانية'); return; }
  for (let i = 0; i < hsDraft.slides.length; i++) {
    const s = hsDraft.slides[i];
    if (!homeUrlOk(s.buttonUrl, true)) { showToast(`⚠️ رابط الزر في الصورة ${i + 1} لازم يبدأ بـ https://`); return; }
    if (s.buttonUrl && !s.buttonLabel) { showToast(`⚠️ اكتب نص الزر للصورة ${i + 1} أو امسح الرابط`); return; }
  }
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ…';
  try {
    hsDraft.interval = interval; hsDraft.ratio = $('#hs2Ratio')?.value || '16/9'; hsDraft.fit = $('#hs2Fit')?.value || 'cover';
    await homeCommit({ ...(liveState.heroSettings || {}), slides: hsDraft.slides, sliderInterval: hsDraft.interval, sliderRatio: hsDraft.ratio, sliderFit: hsDraft.fit }, '✅ تم نشر السلايدر');
    hsDraft = null; hs2PrevIdx = 0; renderContentOnly();
  } catch (err) { homeSaveError(err); btn.disabled = false; btn.textContent = '💾 حفظ ونشر'; }
}
function wireSliderSettings() {
  const list = $('#hs2List'); if (!list || !hsDraft) return;
  hs2RenderList();
  $('#hs2AddInput')?.addEventListener('change', (e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) hs2UploadFiles(f, null); });   // copy first: clearing the input empties the live FileList
  $('#hs2Ratio')?.addEventListener('change', (e) => { hsDraft.ratio = e.target.value; hs2RenderPreview(); });
  $('#hs2Fit')?.addEventListener('change', (e) => { hsDraft.fit = e.target.value; hs2RenderPreview(); });
  $('#hs2Interval')?.addEventListener('input', (e) => { hsDraft.interval = Number(e.target.value) || 5; });
  $('#hs2Save')?.addEventListener('click', hs2Save);
  $('#hs2Reset')?.addEventListener('click', () => { hsDraft = null; hs2PrevIdx = 0; renderContentOnly(); showToast('↩️ تم التراجع عن التعديلات'); });
  $('#hs2Preview')?.addEventListener('click', (e) => { const b = e.target.closest('[data-pv]'); if (b) { hs2PrevIdx = Number(b.dataset.pv) || 0; hs2RenderPreview(); } });
  const find = (el) => { const it = el.closest('.hs2-item'); return it ? hsDraft.slides.findIndex(s => s.id === it.dataset.id) : -1; };
  list.addEventListener('input', (e) => {
    const f = e.target.dataset.f; const i = find(e.target);
    if (!f || i < 0 || f === 'enabled') return;
    hsDraft.slides[i][f] = e.target.value; hs2RenderPreview();
  });
  list.addEventListener('change', (e) => {
    const i = find(e.target);
    if (e.target.dataset.f === 'enabled' && i >= 0) { hsDraft.slides[i].enabled = e.target.checked; e.target.closest('.hs2-item').classList.toggle('off', !e.target.checked); hs2RenderPreview(); }
    else if (e.target.dataset.replace != null && e.target.files?.length) { const idx = i; const f0 = e.target.files[0]; e.target.value = ''; if (idx >= 0 && f0) hs2UploadFiles([f0], idx); }
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const i = find(b); if (i < 0) return;
    const a = b.dataset.act, arr = hsDraft.slides;
    if (a === 'del') { if (!confirm('حذف الصورة دي من السلايدر؟')) return; arr.splice(i, 1); }
    else if (a === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (a === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    hs2RenderList();
  });
  // drag & drop reorder (mouse/desktop; touch uses the ▲ ▼ buttons)
  let dragEl = null;
  list.addEventListener('pointerdown', (e) => { const g = e.target.closest('[data-grip]'); if (g) g.closest('.hs2-item').draggable = true; });
  list.addEventListener('pointerup', () => list.querySelectorAll('.hs2-item').forEach(x => { if (!dragEl) x.draggable = false; }));
  list.addEventListener('dragstart', (e) => { const it = e.target.closest('.hs2-item'); if (!it || !it.draggable) { e.preventDefault(); return; } dragEl = it; it.classList.add('dragging'); if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', it.dataset.id); } catch (_) {} } });
  list.addEventListener('dragover', (e) => {
    if (!dragEl) return; e.preventDefault();
    const after = Array.from(list.querySelectorAll('.hs2-item:not(.dragging)')).find(x => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after) list.insertBefore(dragEl, after); else list.appendChild(dragEl);
  });
  list.addEventListener('dragend', () => {
    if (!dragEl) return;
    const ids = Array.from(list.querySelectorAll('.hs2-item')).map(x => x.dataset.id);
    dragEl.classList.remove('dragging'); dragEl.draggable = false; dragEl = null;
    hsDraft.slides.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    hs2RenderList();
  });
}

/* ── البانر الترويجي ── */
function renderPromoSettings() {
  const c = liveState.heroSettings || {};
  if (!promoDraft) promoDraft = { enabled: c.promoBanner?.enabled === true, imageUrl: c.promoBanner?.imageUrl || '', imagePublicId: c.promoBanner?.imagePublicId || '', linkUrl: c.promoBanner?.linkUrl || '', order: c.promoBanner?.order || 1 };
  return `<div class="hero-settings-stack hs2">
    <div class="hero-settings-card"><div class="hs-head"><div><h3>معاينة البانر</h3><p>بيظهر تحت شبكة الأقسام بنسبته الطبيعية بدون قص — وبس لما يكون مفعّل وفيه صورة.</p></div>${homeSwitch('pm2Enabled', promoDraft.enabled)}</div>
      <div class="hs-body"><div id="pm2Preview"></div>
        <div class="hs-upload-actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><label class="btn gold sm" for="pm2File">📷 رفع / استبدال الصورة</label><input id="pm2File" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" hidden/><button type="button" class="btn danger sm" id="pm2Remove">🗑 إزالة البانر</button></div>
        <div class="hs2-bar" id="pm2Bar" hidden><i></i></div><div class="hs-help" id="pm2Status"></div></div></div>
    <div class="hero-settings-card"><div class="hs-head"><div><h3>إعدادات البانر</h3></div></div><div class="hs-body"><div class="hs-control-grid">
      <div class="hs-field"><label>رابط عند الضغط (اختياري)</label><input type="text" dir="ltr" inputmode="url" id="pm2Link" placeholder="https://..." value="${escAttr(promoDraft.linkUrl)}"/></div>
      <div class="hs-field"><label>ترتيب العرض</label><input type="number" id="pm2Order" min="1" max="99" step="1" value="${Number(promoDraft.order) || 1}"/></div>
    </div><div class="hs-help" style="margin-top:8px">ترتيب العرض بيتحفظ لاستخدامه مستقبلًا لو أضفنا أقسام ترويجية أخرى.</div></div></div>
    <div class="hs2-actions"><button type="button" class="btn ghost" id="pm2Reset">↩️ تراجع عن التعديلات</button><button type="button" class="btn gold" id="pm2Save">💾 حفظ ونشر</button></div>
  </div>`;
}
function pm2RenderPreview() {
  const box = $('#pm2Preview'); if (!box || !promoDraft) return;
  box.innerHTML = promoDraft.imageUrl
    ? `<div class="pm2-pv${promoDraft.enabled ? '' : ' off'}"><img src="${escAttr(promoDraft.imageUrl)}" alt=""/>${promoDraft.enabled ? '' : '<span class="pm2-off">معطّل — مش هيظهر للزوار</span>'}</div>`
    : '<div class="hs2-pv-empty">مفيش صورة بانر. ارفع صورة عشان يظهر.</div>';
}
function wirePromoSettings() {
  if (!$('#pm2Preview') || !promoDraft) return;
  pm2RenderPreview();
  $('#pm2Enabled')?.addEventListener('change', (e) => { promoDraft.enabled = e.target.checked; pm2RenderPreview(); });
  $('#pm2Link')?.addEventListener('input', (e) => { promoDraft.linkUrl = e.target.value.trim(); });
  $('#pm2Order')?.addEventListener('input', (e) => { promoDraft.order = Number(e.target.value) || 1; });
  $('#pm2File')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    const st = $('#pm2Status'), bar = $('#pm2Bar');
    if (bar) { bar.hidden = false; bar.firstElementChild.style.width = '40%'; }
    if (st) st.textContent = '⏳ جاري رفع الصورة…';
    try {
      const r = await uploadMenuImage(f);
      if (!r?.url) throw new Error('رفع الصورة فشل');
      promoDraft.imageUrl = r.url; promoDraft.imagePublicId = r.publicId || '';
      if (st) st.textContent = '✅ تم رفع الصورة — لسه ما اتنشرتش، اضغط «حفظ ونشر».';
      pm2RenderPreview();
    } catch (err) { console.error('promo upload', err); showToast('⚠️ ' + (err?.message || 'فشل رفع الصورة')); if (st) st.textContent = ''; }
    if (bar) { bar.firstElementChild.style.width = '100%'; setTimeout(() => { bar.hidden = true; bar.firstElementChild.style.width = '0'; }, 500); }
  });
  $('#pm2Remove')?.addEventListener('click', () => {
    if (!promoDraft.imageUrl) { showToast('مفيش بانر لإزالته'); return; }
    if (!confirm('إزالة البانر؟ (هتحتاج «حفظ ونشر» عشان يتشال من الموقع)')) return;
    promoDraft.imageUrl = ''; promoDraft.imagePublicId = ''; promoDraft.enabled = false;
    const t = $('#pm2Enabled'); if (t) t.checked = false;
    pm2RenderPreview();
  });
  $('#pm2Reset')?.addEventListener('click', () => { promoDraft = null; renderContentOnly(); showToast('↩️ تم التراجع عن التعديلات'); });
  $('#pm2Save')?.addEventListener('click', async () => {
    const btn = $('#pm2Save');
    if (!homeUrlOk(promoDraft.linkUrl, false)) { showToast('⚠️ رابط البانر لازم يبدأ بـ https://'); return; }
    if (promoDraft.enabled && !promoDraft.imageUrl) { showToast('⚠️ ارفع صورة البانر قبل التفعيل'); return; }
    btn.disabled = true; btn.textContent = '⏳ جاري الحفظ…';
    try {
      await homeCommit({ ...(liveState.heroSettings || {}), promoBanner: { enabled: promoDraft.enabled, imageUrl: promoDraft.imageUrl, imagePublicId: promoDraft.imagePublicId, linkUrl: promoDraft.linkUrl, order: Math.max(1, Math.min(99, Math.round(promoDraft.order || 1))) } }, '✅ تم نشر البانر');
      promoDraft = null; renderContentOnly();
    } catch (err) { homeSaveError(err); btn.disabled = false; btn.textContent = '💾 حفظ ونشر'; }
  });
}

/* ── روابط القائمة الجانبية (بتظهر في الموقع بس لو اتملت) ── */
function renderDrawerSettings() {
  const c = liveState.heroSettings || {};
  if (!dlDraft) dlDraft = { whatsapp: c.drawerLinks?.whatsapp || '', phone: c.drawerLinks?.phone || '', locationUrl: c.drawerLinks?.locationUrl || '' };
  return `<div class="hero-settings-stack hs2"><div class="hero-settings-card"><div class="hs-head"><div><h3>روابط التواصل</h3><p>كل بند بيظهر في القائمة الجانبية بس لو اتملى. سيب الخانة فاضية لإخفائه.</p></div></div><div class="hs-body"><div class="hs-control-grid">
    <div class="hs-field"><label>رقم واتساب (بصيغة دولية بدون +)</label><input type="text" dir="ltr" inputmode="numeric" id="dl2Wa" placeholder="9715XXXXXXXX" value="${escAttr(dlDraft.whatsapp)}"/></div>
    <div class="hs-field"><label>رقم الاتصال (تواصل معنا)</label><input type="text" dir="ltr" inputmode="tel" id="dl2Phone" placeholder="+9714XXXXXXX" value="${escAttr(dlDraft.phone)}"/></div>
    <div class="hs-field" style="grid-column:1/-1"><label>رابط موقعنا (خرائط جوجل)</label><input type="text" dir="ltr" inputmode="url" id="dl2Loc" placeholder="https://maps.google.com/..." value="${escAttr(dlDraft.locationUrl)}"/></div>
  </div></div></div>
  <div class="hs2-actions"><button type="button" class="btn ghost" id="dl2Reset">↩️ تراجع</button><button type="button" class="btn gold" id="dl2Save">💾 حفظ ونشر</button></div></div>`;
}
function wireDrawerSettings() {
  if (!$('#dl2Save') || !dlDraft) return;
  $('#dl2Reset')?.addEventListener('click', () => { dlDraft = null; renderContentOnly(); showToast('↩️ تم التراجع'); });
  $('#dl2Save')?.addEventListener('click', async () => {
    const wa = ($('#dl2Wa').value || '').replace(/[^\d]/g, ''), ph = ($('#dl2Phone').value || '').replace(/[^\d+]/g, ''), loc = ($('#dl2Loc').value || '').trim();
    if (wa && (wa.length < 8 || wa.length > 15)) { showToast('⚠️ رقم الواتساب لازم يكون من 8 إلى 15 رقم بالصيغة الدولية'); return; }
    if (ph && !/^\+?\d{6,19}$/.test(ph)) { showToast('⚠️ رقم الاتصال غير صالح'); return; }
    if (!homeUrlOk(loc, false)) { showToast('⚠️ رابط الموقع لازم يبدأ بـ https://'); return; }
    const btn = $('#dl2Save'); btn.disabled = true; btn.textContent = '⏳ جاري الحفظ…';
    try { await homeCommit({ ...(liveState.heroSettings || {}), drawerLinks: { whatsapp: wa, phone: ph, locationUrl: loc } }, '✅ تم حفظ روابط القائمة'); dlDraft = null; renderContentOnly(); }
    catch (err) { homeSaveError(err); btn.disabled = false; btn.textContent = '💾 حفظ ونشر'; }
  });
}


/* ══════════════════════════════════════
   صفحات الموقع (الفروع / الكيترنج / تابعنا) — محرر عام معتمد على مكوّن Repeater من الـ Design System
   بيتخزن في siteSettings/hero → pages (نفس المستند، نفس الـ Rules، وداخل النسخ الاحتياطي).
══════════════════════════════════════ */
let pagesDraft = null, pagesTab = 'branches';
const PG_STATUS = [['', 'بدون'], ['open', 'مفتوح الآن'], ['closed', 'مغلق الآن']];
const PAGES_CFG = {
  branches: { label: 'الفروع', extra: [], lists: [{ key: 'items', title: 'الفروع', item: 'فرع', max: 12, titleKey: 'name', fields: [
    { k: 'name', l: 'اسم الفرع' }, { k: 'area', l: 'المنطقة / المدينة' }, { k: 'status', l: 'الحالة', type: 'select', opts: PG_STATUS }, { k: 'hours', l: 'ساعات العمل' },
    { k: 'address', l: 'العنوان', full: 1 }, { k: 'phone', l: 'الهاتف', ltr: 1 }, { k: 'mapUrl', l: 'رابط الاتجاهات (https)', ltr: 1, url: 1 },
    { k: 'services', l: 'الخدمات (مفصولة بفاصلة)', full: 1 }, { k: 'image', l: 'صورة الفرع', type: 'image', full: 1 }] }] },
  catering: { label: 'الكيترنج', extra: [{ k: 'quoteTitle', l: 'عنوان طلب عرض السعر' }, { k: 'quoteText', l: 'نص طلب عرض السعر', type: 'textarea' }], lists: [
    { key: 'occasions', title: 'المناسبات', item: 'مناسبة', max: 12, titleKey: 'title', fields: [{ k: 'title', l: 'العنوان' }, { k: 'text', l: 'الوصف', type: 'textarea', full: 1 }, { k: 'image', l: 'صورة', type: 'image', full: 1 }] },
    { key: 'packages', title: 'الباقات', item: 'باقة', max: 9, titleKey: 'title', fields: [{ k: 'title', l: 'اسم الباقة' }, { k: 'price', l: 'السعر (نص حر)' }, { k: 'hot', l: 'الأكثر طلبًا', type: 'bool' }, { k: 'includes', l: 'المحتويات (سطر لكل بند)', type: 'textarea', full: 1 }] },
    { key: 'steps', title: 'خطوات الطلب', item: 'خطوة', max: 8, titleKey: 'title', fields: [{ k: 'title', l: 'العنوان' }, { k: 'text', l: 'الوصف' }] }] },
  social: { label: 'تابعنا', extra: [{ k: 'contactTitle', l: 'عنوان قسم التواصل' }, { k: 'contactText', l: 'نص قسم التواصل', type: 'textarea' }], lists: [
    { key: 'gallery', title: 'صور المعرض', item: 'صورة', max: 24, titleKey: 'image', fields: [{ k: 'image', l: 'الصورة', type: 'image', full: 1 }] }] }
};
function pgFieldHtml(f, val, attrs, uid) {
  const a = attrs, lbl = `<label>${f.l}</label>`, v = val == null ? '' : val;
  if (f.type === 'select') return `<div class="hs-field${f.full ? ' full' : ''}">${lbl}<select ${a}>${f.opts.map(([o, t]) => `<option value="${o}" ${String(v) === o ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  if (f.type === 'textarea') return `<div class="hs-field full">${lbl}<textarea rows="3" ${a}>${escAttr(v)}</textarea></div>`;
  if (f.type === 'bool') return `<div class="hs-field"><label>${f.l}</label><label class="toggle"><input type="checkbox" ${a} ${v ? 'checked' : ''}/><span class="track"></span></label></div>`;
  if (f.type === 'image') return `<div class="hs-field full">${lbl}<div class="rp-img">${v ? `<img src="${escAttr(v)}" alt=""/>` : '<img alt="" style="visibility:hidden"/>'}<label class="btn ghost sm" for="${uid}">📷 رفع / استبدال</label><input id="${uid}" type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden data-up ${a}/>${v ? `<button type="button" class="btn danger sm" data-clr ${a}>إزالة</button>` : ''}</div></div>`;
  return `<div class="hs-field${f.full ? ' full' : ''}">${lbl}<input type="text" ${f.ltr ? 'dir="ltr" ' : ''}maxlength="240" ${a} value="${escAttr(v)}"/></div>`;
}
function renderPagesSettings() {
  const c = liveState.heroSettings || {};
  if (!pagesDraft) pagesDraft = homeClone(c.pages || {});
  ['branches', 'catering', 'social'].forEach(n => { pagesDraft[n] = pagesDraft[n] || {}; });
  return `<div class="hero-settings-stack hs2">
    <div class="ds-seg" id="pgTabs">${Object.keys(PAGES_CFG).map(n => `<button type="button" data-tab="${n}" class="${n === pagesTab ? 'on' : ''}">${PAGES_CFG[n].label}</button>`).join('')}</div>
    <div id="pgPanel"></div>
    <div class="hs2-actions"><button type="button" class="btn ghost" id="pgReset">↩️ تراجع عن التعديلات</button><button type="button" class="btn gold" id="pgSave">💾 حفظ ونشر</button></div></div>`;
}
function pgRenderPanel() {
  const box = $('#pgPanel'); if (!box || !pagesDraft) return;
  const cfg = PAGES_CFG[pagesTab], d = pagesDraft[pagesTab];
  const head = [{ k: 'eyebrow', l: 'السطر العلوي (اختياري)' }, { k: 'title', l: 'عنوان الصفحة (اختياري)' }, { k: 'sub', l: 'نص فرعي', type: 'textarea' }, { k: 'heroImage', l: 'صورة الغلاف', type: 'image', full: 1 }].concat(cfg.extra);
  let h = `<div class="hero-settings-card"><div class="hs-head"><div><h3>صفحة «${cfg.label}»</h3><p>الصفحة بتظهر في القائمة العلوية والجانبية بس لما تتفعّل وفيها محتوى.</p></div>${homeSwitch('pgEnabled', d.enabled === true)}</div><div class="hs-body"><div class="rp-grid">`;
  head.forEach((f, i) => { h += pgFieldHtml(f, d[f.k], `data-h="${f.k}"`, `pgH${i}`); });
  h += '</div></div></div>';
  cfg.lists.forEach(L => {
    const arr = d[L.key] || [];
    h += `<div class="hero-settings-card"><div class="hs-head"><div><h3>${L.title}</h3><p>${arr.length} / ${L.max}</p></div><button type="button" class="btn gold sm" data-act="add" data-list="${L.key}" ${arr.length >= L.max ? 'disabled' : ''}>＋ إضافة ${L.item}</button></div><div class="hs-body"><div class="rp-list">`;
    if (!arr.length) h += `<div class="ds-empty"><div class="ds-empty-t">لسه مفيش ${L.title}</div><div class="ds-empty-s">اضغط «إضافة ${L.item}» للبدء.</div></div>`;
    arr.forEach((it, i) => {
      h += `<div class="rp-item"><div class="rp-head"><b>${L.item} ${i + 1}${it[L.titleKey] && L.titleKey !== 'image' ? ' — ' + escAttr(String(it[L.titleKey]).slice(0, 40)) : ''}</b>
        <button type="button" class="btn ghost sm" data-act="up" data-list="${L.key}" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="أعلى">▲</button>
        <button type="button" class="btn ghost sm" data-act="down" data-list="${L.key}" data-i="${i}" ${i === arr.length - 1 ? 'disabled' : ''} aria-label="أسفل">▼</button>
        <button type="button" class="btn danger sm" data-act="del" data-list="${L.key}" data-i="${i}">🗑</button></div><div class="rp-grid">`;
      L.fields.forEach((f, fi) => { h += pgFieldHtml(f, it[f.k], `data-list="${L.key}" data-i="${i}" data-f="${f.k}"`, `pgU_${L.key}_${i}_${fi}`); });
      h += '</div></div>';
    });
    h += '</div></div></div>';
  });
  box.innerHTML = h;
}
async function pgUpload(file, target) {
  if (!file) return;
  showToast('⏳ جاري رفع الصورة…');
  try {
    const r = await uploadMenuImage(file);
    if (!r?.url) throw new Error('رفع الصورة فشل');
    setPgValue(target, r.url); pgRenderPanel(); showToast('✅ تم رفع الصورة — اضغط «حفظ ونشر» للنشر');
  } catch (err) { console.error('page image upload', err); showToast('⚠️ ' + (err?.message || 'فشل رفع الصورة')); }
}
function setPgValue(t, v) {
  const d = pagesDraft[pagesTab];
  if (t.list) { const it = (d[t.list] || [])[Number(t.i)]; if (it) it[t.f] = v; } else d[t.h] = v;
}
function wirePagesSettings() {
  const panel = $('#pgPanel'); if (!panel || !pagesDraft) return;
  pgRenderPanel();
  const tgt = (el) => el.dataset.list ? { list: el.dataset.list, i: el.dataset.i, f: el.dataset.f } : { h: el.dataset.h };
  $('#pgTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; pagesTab = b.dataset.tab; $$('#pgTabs button').forEach(x => x.classList.toggle('on', x === b)); pgRenderPanel(); });
  panel.addEventListener('input', (e) => { const el = e.target; if (el.matches('[data-up]') || el.type === 'checkbox' || el.tagName === 'SELECT' || (!el.dataset.h && !el.dataset.f)) return; setPgValue(tgt(el), el.value); });
  panel.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'pgEnabled') { pagesDraft[pagesTab].enabled = el.checked; return; }
    if (el.matches('[data-up]')) { const f = el.files && el.files[0]; el.value = ''; pgUpload(f, tgt(el)); return; }
    if (el.type === 'checkbox' && (el.dataset.h || el.dataset.f)) setPgValue(tgt(el), el.checked);
    else if (el.tagName === 'SELECT') setPgValue(tgt(el), el.value);
  });
  panel.addEventListener('click', (e) => {
    const clr = e.target.closest('[data-clr]'); if (clr) { setPgValue(tgt(clr), ''); pgRenderPanel(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const d = pagesDraft[pagesTab], L = PAGES_CFG[pagesTab].lists.find(x => x.key === b.dataset.list), arr = d[b.dataset.list] = d[b.dataset.list] || [], i = Number(b.dataset.i);
    if (b.dataset.act === 'add' && arr.length < L.max) arr.push(Object.assign({ id: homeNewId() }, L.key === 'packages' ? { hot: false } : {}));
    else if (b.dataset.act === 'del') { if (!confirm('حذف العنصر ده؟')) return; arr.splice(i, 1); }
    else if (b.dataset.act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (b.dataset.act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    pgRenderPanel();
  });
  $('#pgReset')?.addEventListener('click', () => { pagesDraft = null; renderContentOnly(); showToast('↩️ تم التراجع عن التعديلات'); });
  $('#pgSave')?.addEventListener('click', async () => {
    for (const n of Object.keys(PAGES_CFG)) {
      const d = pagesDraft[n] || {};
      for (const L of PAGES_CFG[n].lists) {
        for (let i = 0; i < (d[L.key] || []).length; i++) {
          const it = d[L.key][i];
          if (!it[L.titleKey]) { showToast(`⚠️ ${PAGES_CFG[n].label}: ${L.item} ${i + 1} ناقصه ${L.titleKey === 'image' ? 'الصورة' : 'العنوان/الاسم'}`); return; }
          if (it.mapUrl && !homeUrlOk(it.mapUrl, false)) { showToast(`⚠️ رابط الاتجاهات في ${L.item} ${i + 1} لازم يبدأ بـ https://`); return; }
        }
      }
    }
    const btn = $('#pgSave'); btn.disabled = true; btn.textContent = '⏳ جاري الحفظ…';
    try { await homeCommit({ ...(liveState.heroSettings || {}), pages: pagesDraft }, '✅ تم نشر صفحات الموقع'); pagesDraft = null; renderContentOnly(); }
    catch (err) { homeSaveError(err); btn.disabled = false; btn.textContent = '💾 حفظ ونشر'; }
  });
}
