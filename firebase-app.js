/* ══════════════════════════════════════
   FIREBASE APP — إعدادات المشروع
   خد القيم دي من: Firebase Console → Project Settings → Your apps → SDK setup and config
══════════════════════════════════════ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, writeBatch, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  initializeAuth, browserSessionPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCde_rpDGJI8HIr03a1eKaRzPFPo3mrRjI",
  authDomain: "anwarlebanonbakery-5815b.firebaseapp.com",
  projectId: "anwarlebanonbakery-5815b",
  storageBucket: "anwarlebanonbakery-5815b.firebasestorage.app",
  messagingSenderId: "301016473650",
  appId: "1:301016473650:web:1fc3fb5ced7b446cd19c2b"
};

// Cloudinary — تخزين الصور (بديل Firebase Storage، مجاني من غير كارت)
const CLOUDINARY_CLOUD_NAME = "ytihtzxj";
const CLOUDINARY_UPLOAD_PRESET = "Anwar-images";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// Session-only persistence: an admin login is forgotten when the tab/app closes (this is a
// shared, public kiosk tablet — a login must never survive a restart). No popup resolver →
// Firebase does not load apis.google.com or an auth iframe, so the CSP can stay tight.
const auth = initializeAuth(app, { persistence: browserSessionPersistence });

/* ── إعدادات قابلة للتعديل ── */
const POLL_INTERVAL_MS = 2 * 60 * 1000;   // فحص رقم النسخة كل دقيقتين (قراءة واحدة بس)
const FULL_REFRESH_EVERY = 15;           // قراءة كاملة كل 30 دقيقة كشبكة أمان
const ADMIN_IDLE_LOGOUT_MS = 5 * 60 * 1000; // تسجيل خروج تلقائي بعد 5 دقايق بلا حركة داخل لوحة الأدمن

/* ══════════════════════════════════════
   حالة محلية في الذاكرة (مش localStorage)
   بتتحدث من Firestore وبتفضل موجودة طول ما الصفحة مفتوحة
══════════════════════════════════════ */
const DEFAULT_HERO_SETTINGS = {
  enabled: true,
  imageUrl: "https://raw.githubusercontent.com/anwarlebanonbakery/bakery-images/main/file_000000000ca481f4984eeedbbedbf2c1.png",
  imagePublicId: "",
  imageOriginalUrl: "",
  imageSize: { preset: 'original', width: null, height: null },
  imageFit: 'contain',
  backgroundPositionX: 50,
  backgroundPositionY: 0,
  // Defaults below intentionally preserve the original homepage Hero exactly:
  // image-only hero, original background position, original height behavior,
  // original dark bottom overlay, and NO extra title/logo/content injected.
  heightMobile: 320,
  heightDesktop: 340,
  overlay: {
    enabled: true,
    type: "linear",
    color: "#08100c",
    opacity: 0.55,
    direction: "to-bottom"
  },
  content: {
    title: "",
    tagline: "",
    since: ""
  },
  logo: {
    enabled: false,
    url: "logo.png",
    publicId: "",
    size: 108
  },
  contentPosition: { horizontal: "right", vertical: "bottom", x: 88, y: 86 },
  typography: { titleSize: 62, taglineSize: 15, sinceSize: 12 },
  animation: { imageZoom: false, glow: false, contentReveal: true },
  // ── Homepage redesign: stored in the SAME siteSettings/hero document (no new collection) ──
  slides: [],                 // admin-managed hero slider; empty → the single-image hero above is used
  sliderInterval: 5,          // seconds between automatic slide changes
  sliderRatio: '16/9',
  sliderFit: 'cover',
  promoBanner: { enabled: false, imageUrl: '', imagePublicId: '', linkUrl: '', order: 1 },
  drawerLinks: { whatsapp: '', phone: '', locationUrl: '' },
  // ── Site pages (Branches / Catering / Follow Us): same document, so rules + backup/restore already cover them ──
  pages: {
    branches: { enabled: false, eyebrow: '', title: '', sub: '', heroImage: '', items: [] },
    catering: { enabled: false, eyebrow: '', title: '', sub: '', heroImage: '', occasions: [], packages: [], steps: [], quoteTitle: '', quoteText: '' },
    social:   { enabled: false, eyebrow: '', title: '', sub: '', heroImage: '', gallery: [], contactTitle: '', contactText: '' }
  },
  updatedAt: null
};

const HERO_SIZE_PRESETS_FOR_VALIDATION = new Set(['original','square','landscape32','portrait23','landscape43','portrait34','landscape54','portrait45','landscape169','portrait916','wide21','custom']);

function heroSafeUrl(u, allowRelative) {
  const s = String(u == null ? '' : u).trim().slice(0, 2000);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (allowRelative && /^(\.\/|\/(?!\/)|#)/.test(s)) return s;
  return '';
}
function heroClip(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
const HERO_SLIDER_RATIOS = new Set(['16/9', '3/2', '4/3', '21/9', '1/1']);

function sanitizeSitePages(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const list = (a, max, fn) => (Array.isArray(a) ? a : []).slice(0, max).map((x, i) => fn(x || {}, i));
  const id = (x, i) => heroClip(x.id, 40) || ('i' + i);
  const head = (p) => ({ enabled: p.enabled === true, eyebrow: heroClip(p.eyebrow, 60), title: heroClip(p.title, 80), sub: heroClip(p.sub, 240), heroImage: heroSafeUrl(p.heroImage, false) });
  const b = r.branches || {}, c = r.catering || {}, so = r.social || {};
  return {
    branches: { ...head(b), items: list(b.items, 12, (x, i) => ({
      id: id(x, i), name: heroClip(x.name, 80), area: heroClip(x.area, 80), status: ['open', 'closed'].includes(x.status) ? x.status : '',
      hours: heroClip(x.hours, 120), address: heroClip(x.address, 200), phone: String(x.phone || '').replace(/[^\d+]/g, '').slice(0, 20),
      mapUrl: heroSafeUrl(x.mapUrl, false), services: heroClip(x.services, 200), image: heroSafeUrl(x.image, false) })).filter(x => x.name) },
    catering: { ...head(c),
      occasions: list(c.occasions, 12, (x, i) => ({ id: id(x, i), title: heroClip(x.title, 80), text: heroClip(x.text, 240), image: heroSafeUrl(x.image, false) })).filter(x => x.title),
      packages: list(c.packages, 9, (x, i) => ({ id: id(x, i), title: heroClip(x.title, 80), price: heroClip(x.price, 40), hot: x.hot === true, includes: heroClip(x.includes, 600) })).filter(x => x.title),
      steps: list(c.steps, 8, (x, i) => ({ id: id(x, i), title: heroClip(x.title, 80), text: heroClip(x.text, 200) })).filter(x => x.title),
      quoteTitle: heroClip(c.quoteTitle, 80), quoteText: heroClip(c.quoteText, 300) },
    social: { ...head(so), gallery: list(so.gallery, 24, (x, i) => ({ id: id(x, i), image: heroSafeUrl(x.image, false) })).filter(x => x.image),
      contactTitle: heroClip(so.contactTitle, 80), contactText: heroClip(so.contactText, 300) }
  };
}
function mergeHeroSettings(raw = {}) {
  const merged = {
    ...DEFAULT_HERO_SETTINGS,
    ...raw,
    imageSize: { ...DEFAULT_HERO_SETTINGS.imageSize, ...(raw.imageSize || {}) },
    overlay: { ...DEFAULT_HERO_SETTINGS.overlay, ...(raw.overlay || {}) },
    content: { ...DEFAULT_HERO_SETTINGS.content, ...(raw.content || {}) },
    logo: { ...DEFAULT_HERO_SETTINGS.logo, ...(raw.logo || {}) },
    contentPosition: { ...DEFAULT_HERO_SETTINGS.contentPosition, ...(raw.contentPosition || {}) },
    typography: { ...DEFAULT_HERO_SETTINGS.typography, ...(raw.typography || {}) },
    animation: { ...DEFAULT_HERO_SETTINGS.animation, ...(raw.animation || {}) },
    promoBanner: { ...DEFAULT_HERO_SETTINGS.promoBanner, ...(raw.promoBanner || {}) },
    drawerLinks: { ...DEFAULT_HERO_SETTINGS.drawerLinks, ...(raw.drawerLinks || {}) },
    pages: raw.pages && typeof raw.pages === 'object' ? raw.pages : {}
  };

  // v6 introduced these values accidentally as defaults. If the document still
  // contains that untouched combination, treat it as legacy noise and restore
  // the real pre-Hero homepage state. The admin can add content/logo explicitly.
  const c = raw.content || {};
  const l = raw.logo || {};
  const isLegacyInjectedContent =
    c.title === "أنوار لبنان" &&
    c.tagline === "Anwar Lebanon Bakery & Sweets" &&
    c.since === "Since 1995" &&
    (l.url === "logo.png" || !l.url) &&
    l.enabled === true;
  if (isLegacyInjectedContent) {
    merged.content = { ...merged.content, title: "", tagline: "", since: "" };
    merged.logo = { ...merged.logo, enabled: false, url: "logo.png", size: 108 };
    merged.heightDesktop = 340;
    merged.animation = { ...merged.animation, imageZoom: false, glow: false };
  }

  // Keep old/manual Firestore values inside the same safe range used by the admin UI.
  merged.imageFit = ['cover','contain','fill'].includes(merged.imageFit) ? merged.imageFit : 'contain';
  merged.backgroundPositionX = Math.max(0, Math.min(100, Number(merged.backgroundPositionX ?? 50)));
  merged.backgroundPositionY = Math.max(0, Math.min(100, Number(merged.backgroundPositionY ?? 0)));
  merged.heightMobile = Math.max(180, Math.min(700, Number(merged.heightMobile || 320)));
  merged.heightDesktop = Math.max(260, Math.min(800, Number(merged.heightDesktop || 340)));
  merged.overlay.opacity = Math.max(0, Math.min(1, Number(merged.overlay.opacity ?? 0.55)));
  merged.logo.size = Math.max(40, Math.min(180, Number(merged.logo.size || 108)));
  merged.contentPosition.x = Math.max(0, Math.min(100, Number(merged.contentPosition.x ?? 88)));
  merged.contentPosition.y = Math.max(0, Math.min(100, Number(merged.contentPosition.y ?? 86)));
  merged.typography.titleSize = Math.max(34, Math.min(86, Number(merged.typography.titleSize || 62)));
  merged.typography.taglineSize = Math.max(10, Math.min(24, Number(merged.typography.taglineSize || 15)));
  merged.typography.sinceSize = Math.max(9, Math.min(18, Number(merged.typography.sinceSize || 12)));
  if (!HERO_SIZE_PRESETS_FOR_VALIDATION.has(merged.imageSize?.preset)) {
    merged.imageSize.preset = 'original';
    merged.imageSize.width = null;
    merged.imageSize.height = null;
  } else if (merged.imageSize.preset === 'custom') {
    merged.imageSize.width = Math.max(64, Math.min(4096, Number(merged.imageSize.width || 1536)));
    merged.imageSize.height = Math.max(64, Math.min(4096, Number(merged.imageSize.height || 864)));
  }
  // ── Homepage redesign fields (validated here, so both admin saves and public reads are safe) ──
  merged.slides = (Array.isArray(raw.slides) ? raw.slides : []).slice(0, 12).map((sl, i) => ({
    id: heroClip(sl && sl.id, 40) || ('s' + i),
    imageUrl: heroSafeUrl(sl && sl.imageUrl, false),
    imagePublicId: heroClip(sl && sl.imagePublicId, 200),
    title: heroClip(sl && sl.title, 80),
    subtitle: heroClip(sl && sl.subtitle, 160),
    buttonLabel: heroClip(sl && sl.buttonLabel, 30),
    buttonUrl: heroSafeUrl(sl && sl.buttonUrl, true),
    enabled: !(sl && sl.enabled === false)
  })).filter(sl => sl.imageUrl);
  merged.sliderInterval = Math.max(2, Math.min(20, Number(merged.sliderInterval) || 5));
  merged.sliderRatio = HERO_SLIDER_RATIOS.has(merged.sliderRatio) ? merged.sliderRatio : '16/9';
  merged.sliderFit = merged.sliderFit === 'contain' ? 'contain' : 'cover';
  merged.promoBanner = {
    enabled: merged.promoBanner.enabled === true,
    imageUrl: heroSafeUrl(merged.promoBanner.imageUrl, false),
    imagePublicId: heroClip(merged.promoBanner.imagePublicId, 200),
    linkUrl: heroSafeUrl(merged.promoBanner.linkUrl, false),
    order: Math.max(1, Math.min(99, Math.round(Number(merged.promoBanner.order) || 1)))
  };
  merged.pages = sanitizeSitePages(merged.pages);
  merged.drawerLinks = {
    whatsapp: String(merged.drawerLinks.whatsapp || '').replace(/[^\d]/g, '').slice(0, 15),
    phone: String(merged.drawerLinks.phone || '').replace(/[^\d+]/g, '').slice(0, 20),
    locationUrl: heroSafeUrl(merged.drawerLinks.locationUrl, false)
  };
  return merged;
}

export const liveState = {
  categories: [],   // كل التصنيفات (visible فقط للعميل العادي)
  products: {},     // { categoryId: [products...] }
  offers: [],       // عروضنا — منفصلة عن المنتجات، مرتبطة بقسم displayType:'offers'
  heroSettings: mergeHeroSettings(),
  seoSettings: null,
  lastGoodAt: null,
  isOnline: navigator.onLine,
  isAdmin: false,
};

export const DEFAULT_HERO = DEFAULT_HERO_SETTINGS;

let pollTimer = null;
let onDataRefreshed = () => {}; // بتتحدد من الملف الرئيسي بعد ما يجهز الـ DOM
let onConnectionChange = () => {};
let onAdminAuthChange = () => {}; // بتتحدد من index.html — استدعاء واحد بس بعد ما liveState.isAdmin يتحدث

export function setCallbacks({ onRefresh, onConnection, onAdminAuth }) {
  if (onRefresh) onDataRefreshed = onRefresh;
  if (onConnection) onConnectionChange = onConnection;
  if (onAdminAuth) {
    onAdminAuthChange = onAdminAuth;
  }
}

/* ══════════════════════════════════════
   قراءة البيانات (عام + أدمن)
══════════════════════════════════════ */
async function _fetchMenuData() {
  try {
    // اقرأ بدون orderBy عشان المنيو ما تعتمدش على Composite Index،
    // وكمان عشان أي مستند قديم ناقص displayOrder ما يختفيش من النتيجة.
    // الترتيب بيتعمل محليًا بعد القراءة.
    const catsQ = liveState.isAdmin
      ? query(collection(db, "categories"))
      : query(collection(db, "categories"), where("visible", "==", true));

    const prodsQ = liveState.isAdmin
      ? query(collection(db, "products"))
      : query(collection(db, "products"), where("visible", "==", true));

    // العروض لا تدخل في Promise.all مع الأقسام والمنتجات.
    // لو Collection offers غير مسموح بها في Rules، المنيو الأساسية تفضل شغالة.
    const heroPromise = getDoc(doc(db, "siteSettings", "hero")).catch(err => {
      console.warn("Hero settings unavailable; using default hero.", err);
      return null;
    });
    const heroFallbackPromise = getDoc(doc(db, "categories", "system_hero_settings")).catch(() => null);
    const seoPromise = getDoc(doc(db, "siteSettings", "seo")).catch(err => {
      console.warn("SEO settings unavailable; using defaults.", err);
      return null;
    });
    const [catsSnap, prodsSnap, heroSnap, heroFallbackSnap, seoSnap] = await Promise.all([
      getDocs(catsQ),
      getDocs(prodsQ),
      heroPromise,
      heroFallbackPromise,
      seoPromise
    ]);

    const categories = catsSnap.docs
      .filter(d => d.id !== "system_hero_settings")
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ao = Number.isFinite(Number(a.displayOrder)) ? Number(a.displayOrder) : 999999;
        const bo = Number.isFinite(Number(b.displayOrder)) ? Number(b.displayOrder) : 999999;
        return ao - bo;
      });
    const productsByCategory = {};
    prodsSnap.docs.forEach(d => {
      const p = { id: d.id, ...d.data() };
      (productsByCategory[p.categoryId] ||= []).push(p);
    });
    Object.values(productsByCategory).forEach(items => items.sort((a, b) => {
      const ao = Number.isFinite(Number(a.displayOrder)) ? Number(a.displayOrder) : 999999;
      const bo = Number.isFinite(Number(b.displayOrder)) ? Number(b.displayOrder) : 999999;
      return ao - bo;
    }));

    liveState.categories = categories;
    liveState.products = productsByCategory;
    if (heroSnap?.exists()) liveState.heroSettings = mergeHeroSettings(heroSnap.data());
    else if (heroFallbackSnap?.exists()) liveState.heroSettings = mergeHeroSettings(heroFallbackSnap.data());
    liveState.seoSettings = seoSnap?.exists() ? mergeSeoSettings(seoSnap.data()) : mergeSeoSettings();

    // تحميل العروض منفصل. لو فشل، لا نعتبر المنيو Offline ولا نمسح الأقسام.
    try {
      liveState.offers = await loadOffersSafely();
    } catch (offersErr) {
      console.error("Offers fetch failed; keeping menu alive:", offersErr);
      liveState.offers = [];
    }

    liveState.lastGoodAt = new Date();
    if (!liveState.isOnline) {
      liveState.isOnline = true;
      onConnectionChange(true);
    }
    onDataRefreshed();
    return true;
  } catch (err) {
    console.error("Firestore menu fetch failed:", err);
    if (liveState.isOnline) {
      liveState.isOnline = false;
      onConnectionChange(false);
    }
    // لا نمسح آخر نسخة سليمة من categories/products.
    return false;
  }
}

/* ══════════════════════════════════════
   عروضنا — طبقة تخزين مقاومة لمشكلة Rules

   الاستخدام الأساسي: collection باسم offers.
   لو Rules الحالية للمشروع لا تسمح بـ offers، نستخدم نفس
   category document الخاص بعروضنا ونخزن العروض داخل field اسمه offers.
   بهذه الطريقة إضافة العروض لا تكسر المنيو ولا تتطلب Composite Index.
══════════════════════════════════════ */

function getOffersCategoryFromState() {
  return liveState.categories.find(c => c.displayType === 'offers') || null;
}

function sortOffers(items) {
  return [...items].sort((a, b) => {
    const ao = typeof a.displayOrder === 'number' ? a.displayOrder : 999999;
    const bo = typeof b.displayOrder === 'number' ? b.displayOrder : 999999;
    return ao - bo;
  });
}

async function loadOffersSafely() {
  const cat = getOffersCategoryFromState();

  // لو سبق واستخدمنا fallback بسبب Rules، نكمل عليه بعد إعادة تحميل الصفحة.
  if (cat?.offersStorage === 'embedded') {
    let offers = Array.isArray(cat.offers) ? cat.offers : [];
    // بعض العروض القديمة اتخزنت بدون id. نديها id ثابت في الذاكرة
    // عشان أزرار التعديل والحذف تشتغل، ويتم حفظ الـid مع أول تعديل/حذف/ترتيب.
    offers = offers.map(o => ({
      ...o,
      id: o?.id ? String(o.id) : makeEmbeddedOfferId(),
      _storage: 'embedded'
    }));
    if (!liveState.isAdmin) offers = offers.filter(o => o.visible !== false);
    return sortOffers(offers);
  }

  try {
    // لا where + orderBy هنا، حتى لا نحتاج Composite Index.
    const offersQ = liveState.isAdmin
      ? query(collection(db, "offers"))
      : query(collection(db, "offers"), where("visible", "==", true));
    const snap = await getDocs(offersQ);
    let offers = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      _storage: 'collection'
    }));

    if (!liveState.isAdmin) {
      offers = offers.filter(o => o.visible !== false);
    }

    return sortOffers(offers);
  } catch (collectionErr) {
    console.warn("Offers collection unavailable; using embedded offers fallback.", collectionErr);

    if (!cat) return [];

    let offers = Array.isArray(cat.offers) ? cat.offers : [];
    // نفس حماية الـid في حالة الانتقال للـembedded fallback بعد فشل Collection.
    offers = offers.map(o => ({
      ...o,
      id: o?.id ? String(o.id) : makeEmbeddedOfferId(),
      _storage: 'embedded'
    }));

    if (!liveState.isAdmin) {
      offers = offers.filter(o => o.visible !== false);
    }

    return sortOffers(offers);
  }
}

function normalizeEmbeddedOffers(offers) {
  const seen = new Set();
  let featuredUsed = false;
  return (Array.isArray(offers) ? offers : []).map((raw) => {
    const o = { ...(raw || {}) };
    let id = o.id ? String(o.id).trim() : '';
    if (!id || seen.has(id)) {
      id = makeEmbeddedOfferId();
      while (seen.has(id)) id = makeEmbeddedOfferId();
    }
    seen.add(id);
    o.id = id;
    o.displayOrder = seen.size - 1;
    // نسمح بعرض مميّز واحد فقط. أول واحد في الترتيب هو الذي يحتفظ بالتمييز.
    if (o.featured && featuredUsed) o.featured = false;
    if (o.featured) featuredUsed = true;
    o._storage = 'embedded';
    return o;
  });
}

async function saveEmbeddedOffers(offers) {
  const cat = getOffersCategoryFromState();
  if (!cat) {
    throw new Error('قسم عروضنا غير موجود في المنيو. أضف قسم عروضنا أولاً.');
  }

  const clean = normalizeEmbeddedOffers(offers).map(o => {
    const copy = { ...o };
    delete copy._storage;
    return copy;
  });

  const payload = {
    offers: clean,
    offersStorage: 'embedded',
    updatedAt: serverTimestamp()
  };
  try {
    await updateDoc(doc(db, "categories", cat.id), payload);
  } catch (updateErr) {
    // بعض Rules القديمة تتعامل مع setDoc(merge) بشكل أفضل من updateDoc.
    // نجرب نفس المستند بدون استبدال باقي بيانات القسم.
    try {
      await setDoc(doc(db, "categories", cat.id), payload, { merge: true });
    } catch (mergeErr) {
      mergeErr.primaryCode = updateErr?.code || '';
      throw mergeErr;
    }
  }
}

function makeEmbeddedOfferId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'offer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}


/* ══════════════════════════════════════
   Change detection (cuts Firestore reads): every admin write bumps ONE tiny doc (siteSettings/version).
   The always-on screen polls only that doc (1 read) and does the full read (all categories/products/offers)
   only when the number changed. A full refresh still runs every 30 min as a safety net for edits that
   did not bump it (Firebase console edits, older admin pages).
══════════════════════════════════════ */
let lastSeenV;           // undefined = unknown, null = doc doesn't exist yet
async function readStamp() {
  try { const sn = await getDoc(doc(db, "siteSettings", "version")); return sn.exists() ? sn.data().v : null; }
  catch (e) { return undefined; }
}
async function bumpVersion() {
  try { await setDoc(doc(db, "siteSettings", "version"), { v: Date.now() }); } catch (e) { console.warn("version stamp failed:", e?.code || e); }
}
export async function fetchMenuData() {
  const v = await readStamp();            // read BEFORE the data, so a change in between is never missed
  const r = await _fetchMenuData();
  if (v !== undefined) lastSeenV = v;
  return r;
}
export async function createCategory(...args) { const r = await _createCategory(...args); await bumpVersion(); return r; }
export async function updateCategory(...args) { const r = await _updateCategory(...args); await bumpVersion(); return r; }
export async function deleteCategory(...args) { const r = await _deleteCategory(...args); await bumpVersion(); return r; }
export async function createProduct(...args) { const r = await _createProduct(...args); await bumpVersion(); return r; }
export async function updateProduct(...args) { const r = await _updateProduct(...args); await bumpVersion(); return r; }
export async function deleteProduct(...args) { const r = await _deleteProduct(...args); await bumpVersion(); return r; }
export async function reorderCategories(...args) { const r = await _reorderCategories(...args); await bumpVersion(); return r; }
export async function reorderProducts(...args) { const r = await _reorderProducts(...args); await bumpVersion(); return r; }
export async function createOffer(...args) { const r = await _createOffer(...args); await bumpVersion(); return r; }
export async function updateOffer(...args) { const r = await _updateOffer(...args); await bumpVersion(); return r; }
export async function deleteOffer(...args) { const r = await _deleteOffer(...args); await bumpVersion(); return r; }
export async function reorderOffers(...args) { const r = await _reorderOffers(...args); await bumpVersion(); return r; }
export async function saveHeroSettings(...args) { const r = await _saveHeroSettings(...args); await bumpVersion(); return r; }
export async function saveSeoSettings(...args) { const r = await _saveSeoSettings(...args); await bumpVersion(); return r; }
export async function importSiteBackup(...args) { const r = await _importSiteBackup(...args); await bumpVersion(); return r; }

export function startPolling() {
  stopPolling();
  let tick = 0;
  pollTimer = setInterval(async () => {
    if (document.visibilityState !== "visible") return;     // hidden screen: no reads
    tick++;
    if (tick % 15 === 0) { fetchMenuData(); return; }       // 30-min safety-net full refresh
    const v = await readStamp();                            // 1 read
    if (v === undefined) return;                            // offline / error
    if (v === null) { if (tick % 5 === 0) fetchMenuData(); return; }   // no version doc yet → plain 10-min polling
    if (v !== lastSeenV) fetchMenuData();                   // changed → full read
  }, POLL_INTERVAL_MS);
}
export function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

window.addEventListener("online", () => fetchMenuData());
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") fetchMenuData();
});

/* ══════════════════════════════════════
   الأدمن — تسجيل دخول / خروج
══════════════════════════════════════ */
let idleLogoutTimer = null;
export function resetAdminIdleTimer() {
  if (idleLogoutTimer) clearTimeout(idleLogoutTimer);
  if (!liveState.isAdmin) return;
  idleLogoutTimer = setTimeout(() => {
    adminLogout();
  }, ADMIN_IDLE_LOGOUT_MS);
}

export async function adminLogin(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  // onAuthStateChanged below بيحدث liveState.isAdmin تلقائي
}

export async function adminLogout() {
  await signOut(auth);
}

/* ══════════════════════════════════════
   المصدر الوحيد لحالة تسجيل دخول الأدمن.
   index.html ما بيعملش onAuthStateChanged بتاعه — بيسجل نفسه هنا
   عن طريق setCallbacks({ onAdminAuth }) عشان نتجنب أي تعارض/ازدواجية
   في التعامل مع حالة الـ auth.
══════════════════════════════════════ */
/* A Firebase Auth account alone is NOT an admin: anyone can create one with the public API
   key unless sign-ups are disabled. Admin = a document at admins/{uid}, which only the owner can
   create (Firestore rules forbid client writes to it). This check only drives the UI —
   firestore.rules enforces the same condition on the server for every read/write. */
async function verifyAdmin(user) {
  try {
    const snap = await getDoc(doc(db, "admins", user.uid));
    window.__adminCheck = snap.exists() ? 'ok' : 'missing:' + user.uid; // diagnostic only (shown on the login screen when denied)
    return snap.exists();
  } catch (err) {
    window.__adminCheck = String(err?.code || err);
    console.warn("Admin check failed:", err?.code || err);
    return false;
  }
}

let deniedFlag = false;
onAuthStateChanged(auth, async (user) => {
  if (idleLogoutTimer) clearTimeout(idleLogoutTimer);
  if (user && !(await verifyAdmin(user))) {
    deniedFlag = true;
    liveState.isAdmin = false;
    await signOut(auth).catch(() => {});
    return; // signOut fires this callback again with user = null
  }
  liveState.isAdmin = !!user;
  await fetchMenuData(); // إعادة تحميل بصلاحيات مختلفة (يشوف المخفي لو أدمن)
  const info = { denied: deniedFlag };
  deniedFlag = false;
  onAdminAuthChange(user, info); // نبلّغ الواجهة بعد ما البيانات والصلاحية اتحدثوا فعلاً
  if (user) resetAdminIdleTimer();
});

/* ══════════════════════════════════════
   إعدادات الـ Hero — مستند واحد فقط siteSettings/hero
══════════════════════════════════════ */
async function _saveHeroSettings(settings) {
  const clean = mergeHeroSettings(settings);
  try {
    await setDoc(doc(db, "siteSettings", "hero"), { ...clean, updatedAt: serverTimestamp() });
  } catch (primaryErr) {
    // بعض مشاريع Firebase القديمة تسمح للأدمن بالكتابة على categories
    // لكنها لا تحتوي Rule لمسار siteSettings. نستخدم مستندًا عاديًا داخل
    // categories كـ fallback حتى لا يتعطل حفظ الـ Hero.
    try {
      await setDoc(doc(db, "categories", "system_hero_settings"), {
        ...clean,
        __isHeroSettings: true,
        // Keep the fallback readable even when Firestore rules only allow
        // public category reads where visible == true. It is filtered out
        // of the actual category list above by its reserved application ID.
        visible: true,
        displayOrder: 2147483647,
        updatedAt: serverTimestamp()
      });
    } catch (fallbackErr) {
      fallbackErr.primaryCode = primaryErr?.code || '';
      throw fallbackErr;
    }
  }
  liveState.heroSettings = clean;
  return clean;
}

export function getDefaultHeroSettings() {
  return mergeHeroSettings();
}

/* ══════════════════════════════════════
   إعدادات الموقع / SEO — مستند واحد فقط siteSettings/seo
══════════════════════════════════════ */
export const DEFAULT_SEO_SETTINGS = {
  siteName: 'أنوار لبنان Bakery & Sweets',
  title: 'أنوار لبنان — Bakery & Sweets',
  description: 'أنوار لبنان للمخبوزات والحلويات — تشكيلة من المخبوزات والحلويات والعروض.',
  keywords: 'أنوار لبنان, مخبز, حلويات, مخبوزات, Bakery, Sweets',
  ogImage: '',
  themeColor: '#0A3626',
  locale: 'ar_AE',
  updatedAt: null
};

export function mergeSeoSettings(raw = {}) {
  const out = { ...DEFAULT_SEO_SETTINGS, ...(raw || {}) };
  out.siteName = String(out.siteName || DEFAULT_SEO_SETTINGS.siteName).slice(0, 120);
  out.title = String(out.title || DEFAULT_SEO_SETTINGS.title).slice(0, 180);
  out.description = String(out.description || DEFAULT_SEO_SETTINGS.description).slice(0, 300);
  out.keywords = String(out.keywords || '').slice(0, 500);
  out.ogImage = String(out.ogImage || '');
  out.themeColor = /^#[0-9a-f]{6}$/i.test(String(out.themeColor)) ? String(out.themeColor) : DEFAULT_SEO_SETTINGS.themeColor;
  return out;
}

export async function getSeoSettings() {
  try {
    const snap = await getDoc(doc(db, 'siteSettings', 'seo'));
    return snap.exists() ? mergeSeoSettings(snap.data()) : mergeSeoSettings();
  } catch (err) {
    console.warn('SEO settings unavailable; using defaults.', err);
    return mergeSeoSettings();
  }
}

async function _saveSeoSettings(settings) {
  const clean = mergeSeoSettings(settings);
  await setDoc(doc(db, 'siteSettings', 'seo'), { ...clean, updatedAt: serverTimestamp() }, { merge: true });
  liveState.seoSettings = clean;
  return clean;
}

/* ══════════════════════════════════════
   Backup / Restore — بدون المساس بالمصادقة
   يتم حفظ بيانات الموقع فقط، وليس كلمات المرور أو Auth.
══════════════════════════════════════ */
export async function exportSiteBackup() {
  const [cats, products, offers, hero, seo] = await Promise.all([
    getDocs(collection(db, 'categories')),
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'offers')).catch(() => ({ docs: [] })),
    getDoc(doc(db, 'siteSettings', 'hero')).catch(() => null),
    getDoc(doc(db, 'siteSettings', 'seo')).catch(() => null),
  ]);
  return {
    format: 'anwar-lebanon-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: cats.docs.map(d => ({ id: d.id, data: d.data() })),
    products: products.docs.map(d => ({ id: d.id, data: d.data() })),
    offers: offers.docs.map(d => ({ id: d.id, data: d.data() })),
    siteSettings: {
      hero: hero?.exists?.() ? hero.data() : null,
      seo: seo?.exists?.() ? seo.data() : null,
    }
  };
}

async function commitBatchChunks(operations, chunkSize = 450) {
  for (let i = 0; i < operations.length; i += chunkSize) {
    const batch = writeBatch(db);
    operations.slice(i, i + chunkSize).forEach(op => {
      if (op.type === 'delete') batch.delete(doc(db, op.collection, op.id));
      else batch.set(doc(db, op.collection, op.id), op.data, { merge: false });
    });
    await batch.commit();
  }
}

async function _importSiteBackup(backup) {
  if (!backup || backup.format !== 'anwar-lebanon-backup' || Number(backup.version) !== 1) {
    throw new Error('ملف النسخة الاحتياطية غير صالح أو من إصدار غير مدعوم');
  }
  const categories = Array.isArray(backup.categories) ? backup.categories : [];
  const products = Array.isArray(backup.products) ? backup.products : [];
  const offers = Array.isArray(backup.offers) ? backup.offers : [];
  const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
  const valid = item => item && typeof item.id === 'string' && SAFE_ID.test(item.id) && item.data && typeof item.data === 'object' && !Array.isArray(item.data);
  if (!categories.every(valid) || !products.every(valid) || !offers.every(valid)) throw new Error('بيانات النسخة الاحتياطية غير مكتملة');
  if (categories.length > 2000 || products.length > 20000 || offers.length > 5000) throw new Error('النسخة الاحتياطية أكبر من الحد المسموح');
  // Refuse backups that smuggle script-bearing URLs into any field (stored-XSS via a crafted file).
  const dangerous = (v, depth = 0) => {
    if (depth > 12) return true;
    if (typeof v === 'string') return /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i.test(v);
    if (Array.isArray(v)) return v.some(x => dangerous(x, depth + 1));
    if (v && typeof v === 'object') return Object.values(v).some(x => dangerous(x, depth + 1));
    return false;
  };
  if ([...categories, ...products, ...offers].some(x => dangerous(x.data)) || dangerous(backup.siteSettings || {})) {
    throw new Error('النسخة الاحتياطية تحتوي على روابط غير آمنة وتم رفضها');
  }

  // Replace the three content collections so restore is deterministic.
  const existing = await Promise.all([
    getDocs(collection(db, 'categories')),
    getDocs(collection(db, 'products')),
    getDocs(collection(db, 'offers')).catch(() => ({ docs: [] })),
  ]);
  const deletes = [];
  [['categories', existing[0].docs], ['products', existing[1].docs], ['offers', existing[2].docs]].forEach(([collectionName, docs]) => {
    docs.forEach(d => deletes.push({ type: 'delete', collection: collectionName, id: d.id }));
  });
  await commitBatchChunks(deletes);

  const writes = [];
  categories.forEach(x => writes.push({ type: 'set', collection: 'categories', id: x.id, data: x.data }));
  products.forEach(x => writes.push({ type: 'set', collection: 'products', id: x.id, data: x.data }));
  offers.forEach(x => writes.push({ type: 'set', collection: 'offers', id: x.id, data: x.data }));
  await commitBatchChunks(writes);

  if (backup.siteSettings?.hero && typeof backup.siteSettings.hero === 'object') {
    await setDoc(doc(db, 'siteSettings', 'hero'), backup.siteSettings.hero, { merge: false });
  }
  if (backup.siteSettings?.seo && typeof backup.siteSettings.seo === 'object') {
    await setDoc(doc(db, 'siteSettings', 'seo'), backup.siteSettings.seo, { merge: false });
  }
  return true;
}

/* ══════════════════════════════════════
   رفع صورة إلى Cloudinary → يرجع الرابط
   (unsigned upload — من المتصفح مباشرة، من غير سيرفر)
══════════════════════════════════════ */

/* ── ضغط/تصغير الصورة في المتصفح قبل الرفع ──
   لو الصورة جاية من كاميرا موبايل ممكن تكون كذا ميجا وأبعاد ضخمة جدًا
   (أكبر بكتير من أي حاجة هتتعرض بيها في المنيو). الدالة دي بتصغّر أطول
   ضلع في الصورة لحد أقصى معقول وتضغطها لـ JPEG بجودة عالية قبل ما ترفع،
   فالرفع نفسه بيبقى أسرع (خصوصًا على نت موبايل)، ومساحة التخزين المجانية
   على Cloudinary بتفضل لفترة أطول. الشفافية (PNG بلوجو مثلاً) بتتحفظ. */
async function compressImageForUpload(file, maxDim = 2000, quality = 0.85) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  if (file.type === 'image/svg+xml' || file.type === 'image/gif' || file.type === 'image/avif') return file; // متحركة/متجهية/AVIF (الكانفاس مبيعرفش يكتبه) — من غير ضغط
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 1_500_000) { bitmap.close?.(); return file; } // صغيرة بالفعل، مفيش داعي نضغط
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    // PNG and WebP can be transparent: keep their format (a JPEG would turn transparency black). Everything else → JPEG.
    const outType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outType, quality));
    if (!blob || blob.size >= file.size) return file; // لو الضغط ماوفرش حاجة، استخدمي الأصلية
    return new File([blob], file.name, { type: blob.type || outType });
  } catch (err) {
    console.warn('تعذّر ضغط الصورة قبل الرفع، هترفع بحجمها الأصلي:', err);
    return file; // أي مشكلة (متصفح قديم مثلاً) — ارفعي الأصلية زي ما هي، منعطلش الرفع
  }
}

const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB before compression (matches the admin UI limit)

/* Check the real file signature, not just file.type (which comes from the file extension).
   SVG/HTML are rejected on purpose: they can carry scripts. */
async function sniffImageType(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /^(avif|avis)$/.test(ascii(8, 12))) return 'image/avif';
  return null;
}

export async function uploadMenuImage(file) {
  if (!file || !ALLOWED_UPLOAD_TYPES.includes(file.type)) throw new Error('نوع الملف غير مسموح — الصور فقط (JPG / PNG / WebP / AVIF / GIF)');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('حجم الصورة أكبر من 15MB');
  const sniffed = await sniffImageType(file);
  if (!sniffed) throw new Error('محتوى الملف مش صورة صالحة');
  const optimizedFile = await compressImageForUpload(file);
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append("file", optimizedFile);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) throw new Error("فشل رفع الصورة على Cloudinary");
  const data = await res.json();
  // public_id بيتسجل معانا لو حبينا نمسح الصورة بعدين (يدويًا من Cloudinary Console —
  // مفيش مسح تلقائي آمن من المتصفح من غير مفتاح سري)
  return { url: data.secure_url, publicId: data.public_id };
}

export async function deleteMenuImage() {
  // الحذف التلقائي محتاج مفتاح Cloudinary سري (API secret) ومينفعش يتحط في كود عام في المتصفح.
  // الصور القديمة بتفضل موجودة على Cloudinary من غير استخدام — مش مشكلة، الحد المجاني 25GB.
  // لو حبيت تمسح صور قديمة، ده بيتعمل يدوي من Cloudinary Console (Media Library).
}

/* ══════════════════════════════════════
   CRUD — التصنيفات (categories)
══════════════════════════════════════ */
async function _createCategory(data) {
  return addDoc(collection(db, "categories"), {
    ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
}
async function _updateCategory(id, data) {
  return updateDoc(doc(db, "categories", id), { ...data, updatedAt: serverTimestamp() });
}
async function _deleteCategory(id) {
  return deleteDoc(doc(db, "categories", id));
}

/* ══════════════════════════════════════
   CRUD — المنتجات (products)
══════════════════════════════════════ */
async function _createProduct(data) {
  return addDoc(collection(db, "products"), {
    ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
}
async function _updateProduct(id, data) {
  return updateDoc(doc(db, "products", id), { ...data, updatedAt: serverTimestamp() });
}
async function _deleteProduct(id) {
  return deleteDoc(doc(db, "products", id));
}

/* ══════════════════════════════════════
   إعادة الترتيب — حفظ ترتيب جديد لكذا عنصر مرة واحدة
══════════════════════════════════════ */
async function _reorderCategories(orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) => {
    batch.update(doc(db, "categories", id), { displayOrder: i, updatedAt: serverTimestamp() });
  });
  return batch.commit();
}
async function _reorderProducts(orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) => {
    batch.update(doc(db, "products", id), { displayOrder: i, updatedAt: serverTimestamp() });
  });
  return batch.commit();
}

/* ══════════════════════════════════════
   CRUD — العروض (offers)
   منفصلة عن products عشان مالهاش نفس شكل/سلوك المنتج العادي —
   بتتعرض جوا قسم من نوع displayType:'offers' بواجهة "Offers Experience"
   المخصوصة بدل الشبكة العادية.
══════════════════════════════════════ */
async function _createOffer(data) {
  const current = Array.isArray(liveState.offers) ? liveState.offers : [];
  const offersCat = getOffersCategoryFromState();
  // لو القسم معلّم صراحةً إن تخزين العروض Embedded، نلتزم بنفس المصدر
  // حتى لو القائمة الحالية فاضية؛ وإلا ممكن أول إضافة ترجع للـcollection بالغلط.
  const hasEmbedded = current.some(o => o?._storage === 'embedded') || offersCat?.offersStorage === 'embedded';
  if (hasEmbedded) {
    let existing = current.map(o => ({ ...o }));
    const id = makeEmbeddedOfferId();
    if (data?.featured) existing = existing.map(o => ({ ...o, featured: false }));
    existing.push({ id, ...data, displayOrder: existing.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), _storage: 'embedded' });
    const normalized = normalizeEmbeddedOffers(existing);
    await saveEmbeddedOffers(normalized);
    liveState.offers = normalized;
    return { id, embedded: true };
  }

  try {
    if (data?.featured) {
      const batch = writeBatch(db);
      current.filter(o => o?._storage === 'collection' && o.featured).forEach(o => batch.update(doc(db, 'offers', String(o.id)), { featured: false, updatedAt: serverTimestamp() }));
      const ref = doc(collection(db, 'offers'));
      batch.set(ref, { ...data, displayOrder: current.length, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await batch.commit();
      return { id: ref.id, embedded: false };
    }
    const ref = await addDoc(collection(db, 'offers'), { ...data, displayOrder: current.length, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { id: ref.id, embedded: false };
  } catch (err) {
    // Collection غير متاحة: استخدم fallback داخل مستند قسم عروضنا.
    let existing = current.map(o => ({ ...o }));
    const id = makeEmbeddedOfferId();
    if (data?.featured) existing = existing.map(o => ({ ...o, featured: false }));
    existing.push({ id, ...data, displayOrder: existing.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), _storage: 'embedded' });
    const normalized = normalizeEmbeddedOffers(existing);
    await saveEmbeddedOffers(normalized);
    liveState.offers = normalized;
    return { id, embedded: true };
  }
}

async function _updateOffer(id, data) {
  const key = String(id ?? '').trim();
  if (!key) throw new Error('معرف العرض غير موجود');
  const current = Array.isArray(liveState.offers) ? liveState.offers : [];
  const offer = current.find(o => String(o?.id ?? '') === key);
  if (!offer) throw new Error('العرض غير موجود. حدّث الصفحة وحاول مرة أخرى.');

  if (offer._storage === 'embedded') {
    const normalized = normalizeEmbeddedOffers(current.map(o => String(o.id) === key
      ? { ...o, ...data, id: key, updatedAt: new Date().toISOString(), _storage: 'embedded' }
      : { ...o, featured: data?.featured ? false : o.featured, _storage: 'embedded' }));
    await saveEmbeddedOffers(normalized);
    liveState.offers = normalized;
    return true;
  }

  const batch = writeBatch(db);
  if (data?.featured) current.filter(o => o?._storage === 'collection' && String(o.id) !== key && o.featured)
    .forEach(o => batch.update(doc(db, 'offers', String(o.id)), { featured: false, updatedAt: serverTimestamp() }));
  batch.update(doc(db, 'offers', key), { ...data, updatedAt: serverTimestamp() });
  await batch.commit();
  return true;
}

async function _deleteOffer(id) {
  const key = String(id ?? '').trim();
  if (!key) throw new Error('معرف العرض غير موجود');
  const current = Array.isArray(liveState.offers) ? liveState.offers : [];
  const offer = current.find(o => String(o?.id ?? '') === key);
  if (!offer) throw new Error('العرض غير موجود. حدّث الصفحة وحاول مرة أخرى.');

  if (offer._storage === 'embedded') {
    const normalized = normalizeEmbeddedOffers(current.filter(o => String(o.id) !== key));
    await saveEmbeddedOffers(normalized);
    liveState.offers = normalized;
    return true;
  }
  await deleteDoc(doc(db, 'offers', key));
  return true;
}

async function _reorderOffers(orderedIds) {
  const current = Array.isArray(liveState.offers) ? liveState.offers : [];
  const byId = new Map(current.map(o => [String(o?.id ?? ''), o]));
  const seen = new Set();
  const ordered = [];

  (Array.isArray(orderedIds) ? orderedIds : []).forEach(id => {
    const key = String(id ?? '').trim();
    if (!key || seen.has(key) || !byId.has(key)) return;
    seen.add(key);
    ordered.push(byId.get(key));
  });
  current.forEach(o => {
    const key = String(o?.id ?? '').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      ordered.push(o);
    }
  });

  const embedded = ordered.filter(o => o?._storage === 'embedded');
  const collectionOffers = ordered.filter(o => o?._storage !== 'embedded');

  // لو حصلت حالة انتقال/بيانات مختلطة، حافظ على مصدر كل عرض بدل ما نحوّل
  // عروض Collection إلى Embedded بالخطأ. كل مجموعة تحتفظ بنفس ترتيبها النسبي.
  if (embedded.length) {
    const normalized = normalizeEmbeddedOffers(embedded);
    await saveEmbeddedOffers(normalized);
  }

  if (collectionOffers.length) {
    const batch = writeBatch(db);
    collectionOffers.forEach((o, i) => {
      batch.update(doc(db, 'offers', String(o.id)), { displayOrder: i, updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }

  // لا نحتاج لتحويل الحالة المختلطة إلى مصدر واحد؛ نحافظ على نفس الـstorage.
  liveState.offers = [
    ...embedded.map((o, i) => ({ ...o, displayOrder: i, _storage: 'embedded' })),
    ...collectionOffers.map((o, i) => ({ ...o, displayOrder: i, _storage: 'collection' }))
  ].sort((a, b) => {
    const aPos = ordered.findIndex(x => String(x?.id ?? '') === String(a?.id ?? ''));
    const bPos = ordered.findIndex(x => String(x?.id ?? '') === String(b?.id ?? ''));
    return aPos - bPos;
  });
  return true;
}
