/* ══════════════════════════════════════
   kiosk-app.js — منطق عرض المنيو (للعرض فقط)
   الأدمن بقى في صفحة منفصلة: admin.html
   بيقرا من firebase-app.js (liveState) بدل localStorage
══════════════════════════════════════ */
import {
  liveState, setCallbacks, fetchMenuData, startPolling,
} from "./firebase-app.js?v=20261116-8";

/* ── بانر إيرور بسيط يظهر على الشاشة (بدل ما الزرار يبقى ميت من غير أي رسالة) ──
   ده مش تصميم نهائي، الهدف بس إننا نشوف أي خطأ JS بعينا على الموبايل من غير
   ما نحتاج نفتح Developer Tools. لو الموقع شغال تمام مش هيظهر خالص. */
let kioskErrorBannerEl = null;
const KIOSK_DEBUG = (() => { try { return new URLSearchParams(location.search).get('debug') === '1'; } catch { return false; } })();
function showKioskError(msg) {
  console.error('[Kiosk error]', msg);
  if (!KIOSK_DEBUG) return; // production: log only, never show internals to customers
  if (!kioskErrorBannerEl) {
    kioskErrorBannerEl = document.createElement('div');
    kioskErrorBannerEl.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#B4231F;color:#fff;padding:12px 16px;border-radius:12px;font-family:Tajawal,sans-serif;font-size:13px;line-height:1.6;box-shadow:0 8px 24px rgba(0,0,0,.35);direction:rtl;text-align:right;';
    document.body.appendChild(kioskErrorBannerEl);
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕ إخفاء';
    closeBtn.style.cssText = 'margin-top:8px;font-weight:800;cursor:pointer;opacity:.85;';
    closeBtn.onclick = () => kioskErrorBannerEl.remove() || (kioskErrorBannerEl = null);
    kioskErrorBannerEl.appendChild(closeBtn);
  }
  const textNode = document.createElement('div');
  textNode.textContent = msg;
  kioskErrorBannerEl.insertBefore(textNode, kioskErrorBannerEl.firstChild);
}
window.addEventListener('error', (e) => {
  showKioskError('خطأ في الصفحة: ' + (e?.message || 'غير معروف') + (e?.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''));
});
window.addEventListener('unhandledrejection', (e) => {
  showKioskError('خطأ في تحميل بيانات: ' + (e?.reason?.message || e?.reason || 'غير معروف'));
});

/* ── تنفيذ آمن لأي دالة بتتنادى من onclick — لو حصل استثناء، هيظهر في
   البانر بدل ما الزرار يفضل "ميت" من غير أي تفسير ── */
function safeInvoke(fn, ...args) {
  try { fn(...args); }
  catch (err) { showKioskError('حصل خطأ: ' + (err?.message || err)); }
}
window.safeInvoke = safeInvoke;

/* ── الساعة ── */
function updateKioskClock() {
  const el = document.getElementById('kioskClock');
  if (!el) return;
  const timeEl = el.querySelector('.kiosk-clock-time');
  const dateEl = el.querySelector('.kiosk-clock-date');
  const now = new Date();
  const uae = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  const timeText = uae.toLocaleTimeString('ar-AE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateText = uae.toLocaleDateString('ar-AE', { day: '2-digit', month: 'short' });
  if (timeEl) timeEl.textContent = timeText;
  if (dateEl) dateEl.textContent = dateText;
  if (!timeEl && !dateEl) el.textContent = timeText;
}
updateKioskClock();
setInterval(updateKioskClock, 15000);

/* ── صفحاتنا عبر التواصل الاجتماعي: تتبدل زوجيًا تحت الساعة ── */
(function initKioskSocialRotator(){
  const root = document.getElementById('kioskSocialRotator');
  if (!root) return;
  const pairs = Array.from(root.querySelectorAll('.kiosk-social-pair'));
  if (pairs.length < 2) return;
  let index = 0;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  setInterval(() => {
    pairs[index].classList.remove('active');
    index = (index + 1) % pairs.length;
    pairs[index].classList.add('active');
  }, 4200);
})();

/* ── تحميل الصور بشكل تدريجي (skeleton) ── */
const EAGER_COUNT = 6; // images in the first screenful are not lazy-loaded
const CAT_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='260' viewBox='0 0 400 260'%3E%3Crect width='400' height='260' fill='%23EAD9C5'/%3E%3Ccircle cx='200' cy='110' r='40' fill='%23D4A830' opacity='0.3'/%3E%3Ctext x='200' y='165' text-anchor='middle' font-family='sans-serif' font-size='13' fill='%23B07040'%3Eلا توجد صورة%3C/text%3E%3C/svg%3E";

/* ── تصغير/ضغط الصور تلقائيًا عن طريق Cloudinary وقت العرض ──
   المشكلة الأصلية: الصور بترفع بحجمها الأصلي من الموبايل (ممكن تكون كذا
   ميجا وأبعاد ضخمة)، وبتتحمّل بنفس الحجم ده حتى لو هي كارت صغير 300px.
   الدالة دي بتضيف باراميتر في رابط Cloudinary نفسه (بدون رفع صورة جديدة
   وبدون أي تغيير في الأدمن) يخلي Cloudinary:
   - يحوّل الصورة لصيغة أخف تلقائيًا (WebP/AVIF) حسب المتصفح — f_auto
   - يختار أفضل جودة ممكنة بأقل حجم ملف — q_auto
   - يصغّر الصورة لعرض مناسب لمكان عرضها فعليًا على الشاشة — w_...
   لو الرابط مش من Cloudinary أصلاً (زي صورة الهيرو المرفوعة على GitHub)،
   الدالة بترجّع الرابط زي ما هو من غير تغيير. */
function cldOptimize(url, width) {
  if (!url || typeof url !== 'string') return url;
  const marker = '/image/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url; // مش رابط Cloudinary — رجّعيه زي ما هو
  const before = url.slice(0, idx + marker.length);
  const after = url.slice(idx + marker.length);
  if (/^f_auto,q_auto/.test(after)) return url; // already optimised — never stack transformations
  const t = ['f_auto', 'q_auto'];
  if (width) t.push(`w_${width}`, 'c_limit');
  return `${before}${t.join(',')}/${after}`;
}
window.cldOptimize = cldOptimize; // لازم يبقى متاح عالميًا عشان onclick المكتوب كـ نص (inline) يقدر ينادي عليه

function applyPublicSeo(settings) {
  const c = settings || {};
  const title = String(c.title || 'أنوار لبنان — Bakery & Sweets');
  const description = String(c.description || 'أنوار لبنان للمخبوزات والحلويات والعروض.');
  document.title = title;
  const set = (sel, value) => { const el = document.querySelector(sel); if (el && value != null) el.setAttribute('content', String(value)); };
  set('#metaDescription', description);
  set('#metaKeywords', c.keywords || '');
  set('#metaThemeColor', c.themeColor || '#0A3626');
  set('#metaOgTitle', title);
  set('#metaOgDescription', description);
  if (c.ogImage) set('#metaOgImage', c.ogImage);
  let ld = document.getElementById('siteJsonLd');
  if (!ld) { ld = document.createElement('script'); ld.type='application/ld+json'; ld.id='siteJsonLd'; document.head.appendChild(ld); }
  ld.textContent = JSON.stringify({
    '@context':'https://schema.org', '@type':'Bakery', name:c.siteName || 'أنوار لبنان Bakery & Sweets',
    description, image:c.ogImage ? [c.ogImage] : undefined
  });
}


function setupImageLoading(img, fallback) {
  const wrap = img.parentElement;
  const done = () => {
    img.classList.add('img-loaded');
    // per-card wrappers are rebuilt with every render, so it is safe to mark them (stops the shimmer animation)
    if (wrap && wrap.matches && wrap.matches('.prod-img-wrap,.cat-img-wrap,.gallery-item')) wrap.classList.add('img-ready');
  };
  const fail = () => {
    // 1) the optimised Cloudinary URL failed → retry ONCE with the original (untransformed) URL
    const cur = img.currentSrc || img.src;
    if (!img.dataset.retried && cur && cur !== fallback) {
      const raw = cur.replace(/\/image\/upload\/f_auto,q_auto[^/]*\//, '/image/upload/');
      if (raw !== cur) {
        img.dataset.retried = '1';
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', fail, { once: true });
        img.src = raw;
        return;
      }
    }
    // 2) still failing → neat placeholder, never a broken-image icon
    if (img.src !== fallback) img.src = fallback;
    done();
  };
  if (img.complete && img.naturalWidth > 0) done();
  else if (img.complete) fail();
  else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', fail, { once: true }); }
}

/* ── مؤشر "المزيد بالأسفل" ── */
let scrollTicking = false;
const scrollMoreIndicatorEl = document.getElementById('scrollMoreIndicator');
const viewHomeEl = document.getElementById('view-home');
function checkScrollIndicator() {
  if (!scrollMoreIndicatorEl) return;
  const atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 24);
  const homeActive = viewHomeEl.classList.contains('active');
  scrollMoreIndicatorEl.classList.toggle('show', homeActive && !atBottom);
}
window.addEventListener('scroll', () => {
  if (!scrollTicking) { scrollTicking = true; requestAnimationFrame(() => { checkScrollIndicator(); scrollTicking = false; }); }
}, { passive: true });
window.addEventListener('resize', checkScrollIndicator, { passive: true });

let gridResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(gridResizeTimer);
  gridResizeTimer = setTimeout(() => {
    const homeGrid = document.getElementById('homeGrid');
    if (homeGrid) fitGridColumns(homeGrid, liveState.categories.length, 230);
    // في وضع الأقسام الفرعية بيبقى فيه أكتر من grid جوا الصفحة، كل واحد بعدد أصنافه
    document.querySelectorAll('#products-grid .products-grid').forEach(g => {
      fitGridColumns(g, g.children.length, 220);
    });
  }, 200);
}, { passive: true });

/* ══════════════════════════════════════
   عرض الصفحة الرئيسية (الأقسام)
══════════════════════════════════════ */
const fallbackImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23F5EDE3'/%3E%3Ccircle cx='200' cy='120' r='45' fill='%23EAD9C5'/%3E%3Ctext x='200' y='195' text-anchor='middle' font-family='sans-serif' font-size='14' fill='%23B07040'%3Eالصورة غير متاحة%3C/text%3E%3C/svg%3E";


/* ── Homepage Hero — driven by siteSettings/hero with safe defaults ── */
function heroRgba(hex, opacity) {
  const h = String(hex || '#08100c').replace('#','');
  const full = h.length === 3 ? h.split('').map(x=>x+x).join('') : h.padEnd(6,'0').slice(0,6);
  const r=parseInt(full.slice(0,2),16)||0,g=parseInt(full.slice(2,4),16)||0,b=parseInt(full.slice(4,6),16)||0;
  return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,Number(opacity)||0))})`;
}
function heroOverlayStyle(o) {
  if (!o?.enabled) return 'transparent';
  const color=heroRgba(o.color,o.opacity), transparent=heroRgba(o.color,0), type=o.type||'linear';
  if(type==='solid') return color;
  if(type==='radial') return `radial-gradient(circle at 50% 50%, ${color} 0%, ${transparent} 100%)`;
  return `linear-gradient(${o.direction||'to-bottom'}, ${transparent} 45%, ${color} 100%)`;
}
function renderHero() {
  const hero=document.getElementById('menuHero');
  if(!hero) return;
  const c=liveState.heroSettings || {};
  const o=c.overlay || {};
  const content=c.content || {};
  const logo=c.logo || {};
  const pos=c.contentPosition || {};
  const typo=c.typography || {};
  const anim=c.animation || {};
  const bg=document.getElementById('menuHeroBg'), overlay=document.getElementById('menuHeroOverlay'), glow=document.getElementById('menuHeroGlow'), contentEl=document.getElementById('menuHeroContent');
  hero.classList.toggle('hero-disabled', c.enabled === false);
  if (renderHeroSlider(hero)) return;           // admin-managed slider active → legacy single-image hero stays untouched underneath
  const imageFit = ['cover','contain','fill'].includes(c.imageFit) ? c.imageFit : 'contain';
  hero.classList.toggle('hero-fit-contain', imageFit === 'contain');
  hero.classList.toggle('hero-fit-cover', imageFit === 'cover');
  hero.classList.toggle('hero-fit-fill', imageFit === 'fill');
  hero.style.setProperty('--hero-h-mobile', `${Number(c.heightMobile||320)}px`);
  hero.style.setProperty('--hero-h-desktop', `${Number(c.heightDesktop||340)}px`);
  hero.style.setProperty('--hero-bg-x', `${Number(c.backgroundPositionX ?? 50)}%`);
  hero.style.setProperty('--hero-bg-y', `${Number(c.backgroundPositionY ?? 0)}%`);

  // Contain + fixed height creates the big empty/green letterbox shown on mobile.
  // Instead, measure the real image and make the Hero use the same aspect ratio.
  const heroOptimizedUrl = c.imageUrl ? cldOptimize(String(c.imageUrl), 1400) : '';
  if (imageFit === 'contain' && c.imageUrl) {
    const heroUrl = heroOptimizedUrl;
    const alreadyMeasured = hero.dataset.heroContainUrl === heroUrl && hero.style.getPropertyValue('--hero-image-aspect');
    hero.dataset.heroContainUrl = heroUrl;
    const probe = alreadyMeasured ? null : new Image(); // same URL already measured → no second Image() at all
    if (probe) {
    probe.onload = () => {
      if (hero.dataset.heroContainUrl !== heroUrl) return;
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        hero.style.setProperty('--hero-image-aspect', `${probe.naturalWidth} / ${probe.naturalHeight}`);
      }
    };
    probe.onerror = () => {
      if (hero.dataset.heroContainUrl === heroUrl) hero.style.setProperty('--hero-image-aspect', '16 / 9');
    };
    probe.src = heroUrl;
    }
  } else {
    delete hero.dataset.heroContainUrl;
    hero.style.removeProperty('--hero-image-aspect');
  }

  try { if (heroOptimizedUrl) localStorage.setItem('anwarHeroUrl', heroOptimizedUrl); } catch (e) {}
  if(bg){
    bg.style.backgroundImage = heroOptimizedUrl ? `url(${JSON.stringify(heroOptimizedUrl)})` : 'none';
    bg.style.backgroundPosition = imageFit === 'contain' ? 'center center' : `${Number(c.backgroundPositionX ?? 50)}% ${Number(c.backgroundPositionY ?? 0)}%`;
    bg.style.backgroundSize = imageFit === 'fill' ? '100% 100%' : (imageFit === 'contain' ? '100% 100%' : 'cover');
    const zoomEnabled = anim.imageZoom === true && imageFit !== 'contain';
    bg.classList.toggle('hero-zoom-on', zoomEnabled);
    bg.classList.toggle('hero-zoom-off', !zoomEnabled);
    // Hard reset: if Zoom is switched OFF after an animation already ran,
    // never allow the previous transform/fill-mode to leave the image enlarged.
    if (!zoomEnabled) {
      bg.style.animation = 'none';
      bg.style.transform = 'none';
      bg.style.willChange = 'auto';
    } else {
      bg.style.animation = '';
      bg.style.transform = '';
      bg.style.willChange = 'transform';
    }
  }
  if(overlay) overlay.style.background=heroOverlayStyle(o);
  if(glow) glow.style.display=anim.glow===false?'none':'';
  if(contentEl){
    const h=pos.horizontal==='left'?12:pos.horizontal==='center'?50:pos.horizontal==='right'?88:Number(pos.x??88);
    const v=pos.vertical==='top'?14:pos.vertical==='center'?50:pos.vertical==='bottom'?86:Number(pos.y??86);
    contentEl.style.left=`${h}%`; contentEl.style.top=`${v}%`; contentEl.style.transform='translate(-50%,-50%)';
    contentEl.classList.toggle('hero-content-noanim', anim.contentReveal===false);
    const hasVisibleContent = logo.enabled !== false || !!content.title || !!content.tagline || !!content.since;
    contentEl.classList.toggle('hero-content-empty', !hasVisibleContent);
  }
  const img=document.getElementById('menuHeroLogo');
  if(img){ img.src=logo.url||'logo.png'; img.style.width=`${Number(logo.size||108)}px`; img.style.height=`${Number(logo.size||108)}px`; img.style.display=logo.enabled===false?'none':''; }
  const name=document.getElementById('menuHeroName'); if(name){name.textContent=content.title||'';name.style.fontSize=`clamp(42px, ${Math.min(15,Math.max(9,Number(typo.titleSize||62)/6))}vw, ${Number(typo.titleSize||62)}px)`;name.style.display=content.title?'block':'none';}
  const tagline=document.getElementById('menuHeroTagline'); if(tagline){tagline.textContent=content.tagline||'';tagline.style.fontSize=`${Number(typo.taglineSize||15)}px`;tagline.style.display=content.tagline?'block':'none';}
  const since=document.getElementById('menuHeroSince'); if(since){since.textContent=content.since||'';since.style.fontSize=`${Number(typo.sinceSize||12)}px`;since.style.display=content.since?'flex':'none';}
  const preload=document.getElementById('heroPreload'); if(preload && heroOptimizedUrl && preload.href!==heroOptimizedUrl) preload.href=heroOptimizedUrl;
}

function countLabel(cat) {
  if (cat.displayType === 'image') return '📋 اضغط لعرض المنيو';
  if (cat.displayType === 'gallery') return '✨ معرض صور';
  if (cat.displayType === 'offers') return '🎁 عروض وخصومات خاصة';
  const n = (liveState.products[cat.id] || []).length;
  return n + ' صنف';
}

/* ── تقسيم الأعمدة ديناميكيًا حسب المساحة وعدد العناصر (يمنع صف أخير فاضي) ──
   ملحوظة: من موبايل لحد آخر مقاس آيباد (لغاية 1499px) الـCSS هو اللي بيتحكم
   في عدد الأعمدة (3 بورتريه / 4 لاندسكيب) — الدالة دي بتشتغل بس على الديسك
   توب الحقيقي (1500px فأكتر) عشان الجافاسكريبت مايكتبش فوق الـCSS ويبهدل
   الشبكة لما الآيباد يتلف. */
function fitGridColumns(grid, itemCount, minCardPx) {
  if (!grid || itemCount === 0) return;
  if (window.innerWidth < 1500) { grid.style.gridTemplateColumns = ''; return; } // موبايل + آيباد: سيب الـ CSS الثابت
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.columnGap) || 20;
  const innerWidth = grid.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
  let maxCols = Math.max(1, Math.floor((innerWidth + gap) / (minCardPx + gap)));
  maxCols = Math.min(maxCols, itemCount);
  const minCols = Math.min(maxCols, 2);

  // دوري على عدد أعمدة يقسم العدد بالظبط (صفر فراغ)، وإلا اختاري اللي بيسيب أقل فراغ في الصف الأخير
  let best = maxCols;
  let bestGapSlots = (maxCols - (itemCount % maxCols)) % maxCols;
  for (let cols = maxCols; cols >= minCols; cols--) {
    const remainder = itemCount % cols;
    const gapSlots = remainder === 0 ? 0 : cols - remainder;
    if (gapSlots < bestGapSlots) { best = cols; bestGapSlots = gapSlots; }
    if (gapSlots === 0) { best = cols; bestGapSlots = 0; break; }
  }
  grid.style.gridTemplateColumns = `repeat(${best}, 1fr)`;
}

function renderHomeGrid() {
  const grid = document.getElementById('homeGrid');
  if (!grid) return;
  grid.innerHTML = liveState.categories.map((cat, idx) => {
    const imageUrl = escapeHtml(cldOptimize(cat.imageUrl || '', 500));
    const name = escapeHtml(cat.name || '');
    const lazy = idx < EAGER_COUNT ? 'eager' : 'lazy'; // first row(s) are above the fold → load immediately
    return `
      <div class="cat-card" style="--i:${idx}" data-cat-idx="${idx}" data-hero-id="cat-${escapeHtml(String(cat.id != null ? cat.id : idx))}">
        <div class="cat-img-wrap">
          <img class="cat-img" src="${imageUrl}" alt="${name}" loading="${lazy}" decoding="async"/>
          <div class="cat-img-overlay"></div>
        </div>
        <div class="cat-body">
          <div class="cat-name">${name}</div>
          <div class="cat-meta"><div class="cat-arrow">←</div><div class="cat-count">${countLabel(cat)}</div></div>
        </div>
      </div>`;
  }).join('');
  grid.querySelectorAll('.cat-img').forEach(img => setupImageLoading(img, CAT_FALLBACK));
  fitGridColumns(grid, liveState.categories.length, 230);
  renderPromoBanner();
  runHomeSearch();
}

/* One delegated listener (no inline handlers → CSP-safe, and no string-built JS that a
   category name containing a quote could break out of). */
document.getElementById('homeGrid')?.addEventListener('click', (e) => {
  const card = e.target.closest ? e.target.closest('.cat-card[data-cat-idx]') : null;
  if (!card) return;
  const cat = liveState.categories[Number(card.dataset.catIdx)];
  if (!cat) return;
  if (cat.displayType === 'image') safeInvoke(openImageMenu, cldOptimize(String(cat.menuImageUrl || ''), 1400), String(cat.name || ''));
  else safeInvoke(openCategory, String(cat.id || ''));
});

/* ── أصناف بسعر واحد أو بأحجام (وسط/كبير...) ── */
function buildPriceHTML(item) {
  if (item.sizePrices && item.sizePrices.length) {
    return `<div class="prod-sizeprice-row">${item.sizePrices.map(s =>
      `<span class="prod-sizeprice-chip"><span class="sz-name">${escapeHtml(s.name || '')}</span><span class="sz-val">${escapeHtml(s.price)}</span> <span class="prod-currency">AED</span></span></span>`
    ).join('')}</div>`;
  }
  if (item.price !== undefined && item.price !== null)
    return `<div class="prod-price">${escapeHtml(item.price)}<span class="prod-currency">AED</span></div>`;
  return `<div class="prod-price dash">—</div>`;
}
function buildBadgeHTML(item) {
  if (item.sizePrices && item.sizePrices.length) {
    // في وضع الأحجام المتعددة، الأسعار كاملة بتتعرض تحت اسم الصنف بوضوح (وسط/كبير)، فمفيش داعي لبادچ ملخّص فوق الصورة ممكن يوهم إنه سعر واحد
    return '';
  }
  if (item.price !== undefined && item.price !== null)
    return `<div class="prod-badge">${escapeHtml(item.price)} <span class="badge-currency">AED</span></div>`;
  return `<div class="prod-badge no-price">—</div>`;
}

let currentCategoryId = null;
let sectionObserver = null;

/* ── بناء كارت صنف واحد (بيتستخدم في الوضع العادي ووضع الأقسام الفرعية) ── */
function buildProductCard(item, eager = false) {
  const lz = eager ? 'eager' : 'lazy';
  const card = document.createElement('div');
  card.className = 'prod-card' + (item.wide ? ' wide' : '') + (item.tall ? ' tall' : '') + (item.hideInfo ? ' photo-only' : '');
  if (item.id != null) card.dataset.heroId = item.id; // stable id → shared-element transition name (hero-transition.js)
  // secondary controls (button / link / [data-no-nav]) never trigger card navigation
  card.onclick = (e) => { if (e && e.target && e.target.closest && e.target.closest('button,a,input,[data-no-nav]')) return; if (window.PRODUCT_PAGE !== false && document.getElementById('view-product') && findProductById(item.id)) { safeInvoke(openProduct, item.id); return; } safeInvoke(openImageMenu, cldOptimize(item.imageUrl, 1200), item.name); };

  /* ── صنف "صورة بس" (بدون اسم أو سعر) — بيعرض الصورة لوحدها من غير أي نص ── */
  if (item.hideInfo) {
    card.innerHTML = `
      <div class="prod-img-wrap photo-only-wrap">
        <img class="prod-img" src="${escapeHtml(cldOptimize(item.imageUrl || '', 400))}" alt="${escapeHtml(item.name || '')}" loading="${lz}" decoding="async"/>
      </div>`;
    return card;
  }

  let extras = '';
  if (item.sizes && item.sizes.length) extras += `<div class="prod-sizes">${item.sizes.map(s => `<span class="prod-size-chip">${escapeHtml(s)}</span>`).join('')}</div>`;
  if (item.flavors && item.flavors.length) extras += `<div class="prod-flavors">${item.flavors.map(f => `<span class="prod-flavor-chip">${escapeHtml(f)}</span>`).join('')}</div>`;
  if (item.description) extras += `<div class="prod-note">${escapeHtml(item.description)}</div>`;
  let manaesh = '';
  if (item.manaeshTypes && item.manaeshTypes.length) manaesh = `<div class="manaesh-types">${item.manaeshTypes.map(t => `<span class="manaesh-chip">${escapeHtml(t)}</span>`).join('')}</div>`;
  card.innerHTML = `
    <div class="prod-img-wrap">
      <img class="prod-img" src="${escapeHtml(cldOptimize(item.imageUrl || '', 400))}" alt="${escapeHtml(item.name || '')}" loading="${lz}" decoding="async"/>
      ${buildBadgeHTML(item)}
    </div>
    <div class="prod-body">
      <div>
        <div class="prod-name">${escapeHtml(item.name || '')}</div>
        ${extras}${manaesh}
      </div>
      <div class="prod-price-row">
        ${buildPriceHTML(item)}
      </div>
    </div>`;
  return card;
}

/* ── تعمير شبكة أصناف واحدة داخل حاوية معينة ── */
function fillProductsGrid(grid, items, eagerCount = EAGER_COUNT) {
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => frag.appendChild(buildProductCard(item, i < eagerCount)));
  grid.appendChild(frag);
  grid.querySelectorAll('.prod-img').forEach(img => setupImageLoading(img, fallbackImg));
  fitGridColumns(grid, items.length, 220);
  const cards = grid.querySelectorAll('.prod-card');
  cards.forEach((c, i) => { c.style.transitionDelay = (Math.min(i, 10) * 50) + 'ms'; });
  requestAnimationFrame(() => requestAnimationFrame(() => cards.forEach(c => c.classList.add('show'))));
}

/* ── وضع الأقسام الفرعية: شريط تابز ثابت + سكرول خفيف لكل سكشن ── */
function renderSectionedCategory(wrap, cat, items) {
  const sections = cat.sections || [];
  const bySection = {};
  sections.forEach(s => { bySection[s.id] = []; });
  const others = [];
  items.forEach(item => {
    if (item.sectionId && bySection[item.sectionId]) bySection[item.sectionId].push(item);
    else others.push(item);
  });
  const allSections = others.length ? [...sections, { id: '__other', name: 'أصناف أخرى' }] : sections;
  if (others.length) bySection.__other = others;

  wrap.classList.remove('products-grid');
  wrap.classList.add('products-wrap');
  wrap.innerHTML = `
    <div class="section-tabs-bar" id="sectionTabsBar">
      ${allSections.map((s, i) => `<button class="section-tab${i === 0 ? ' active' : ''}" data-section="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`).join('')}
    </div>
    ${allSections.map(s => `
      <div class="section-block" id="sec-${escapeHtml(s.id)}">
        <div class="section-block-title">${escapeHtml(s.name)}</div>
        <div class="products-grid" data-section="${escapeHtml(s.id)}"></div>
      </div>`).join('')}
  `;

  allSections.forEach((s, si) => {
    const grid = wrap.querySelector(`.products-grid[data-section="${CSS.escape(String(s.id))}"]`);
    fillProductsGrid(grid, bySection[s.id] || [], si === 0 ? EAGER_COUNT : 0); // only the first section is visible on open
  });

  const tabsBar = wrap.querySelector('#sectionTabsBar');
  tabsBar.querySelectorAll('.section-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = document.getElementById('sec-' + tab.dataset.section);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if (sectionObserver) sectionObserver.disconnect();
  sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id.replace('sec-', '');
      tabsBar.querySelectorAll('.section-tab').forEach(t => t.classList.toggle('active', t.dataset.section === id));
      const activeTab = tabsBar.querySelector('.section-tab.active');
      if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }, { rootMargin: '-160px 0px -65% 0px', threshold: 0 });
  wrap.querySelectorAll('.section-block').forEach(block => sectionObserver.observe(block));
}

/* ══════════════════════════════════════
   معرض الصور — النظام الأساسي المشترك
   عروضنا + حلويات غربية يستخدمان نفس تجربة المعرض.
══════════════════════════════════════ */
let galleryObserver = null;
let offersCountdownTimer = null;
let offersState = null;

const SECTION_PHRASES = {
  gallery: 'لحظات حلوة… تُرى قبل أن تُذاق.',
  offers: 'لسنا الوحيدين… لكننا نسعى دائمًا لنكون الأفضل. ❤️'
};


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function offerIsLive(o) {
  const now = Date.now();
  if (o?.startAt) {
    const start = new Date(o.startAt).getTime();
    if (!Number.isNaN(start) && now < start) return false;
  }
  if (o?.endAt) {
    const end = new Date(o.endAt).getTime();
    if (!Number.isNaN(end) && now > end) return false;
  }
  return true;
}

function teardownOffersShowcase() {
  if (offersCountdownTimer) clearInterval(offersCountdownTimer);
  offersCountdownTimer = null;
  offersState = null;
}

function renderSectionIntro(type) {
  const text = SECTION_PHRASES[type] || '';
  if (!text) return '';
  return `<div class="section-gallery-intro" aria-hidden="true"><span>${text}</span></div>`;
}

function safeOfferActionUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return '';
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(raw)) return raw;
  return '';
}

function offerDiscountPercentPublic(o) {
  if (o?.discountPercent != null && o.discountPercent !== '') {
    const n = Number(o.discountPercent);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  const orig = Number(o?.originalPrice), disc = Number(o?.discountPrice);
  if (orig > 0 && disc >= 0 && disc <= orig) return Math.round(((orig - disc) / orig) * 100);
  return null;
}

function formatOfferCountdown(ms) {
  if (ms <= 0) return 'انتهى العرض';
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return days > 0
    ? `${days} يوم ${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
    : `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
}

function updateOfferCountdowns(root) {
  root.querySelectorAll('[data-offer-countdown-end]').forEach(el => {
    const end = Number(el.dataset.offerCountdownEnd);
    if (!Number.isFinite(end)) return;
    el.textContent = formatOfferCountdown(end - Date.now());
  });
}

function renderGalleryView(wrap, images, options = {}) {
  const type = options.type || 'gallery';
  const isOffers = type === 'offers';
  const safeImages = Array.isArray(images) ? images.filter(Boolean) : [];

  wrap.classList.remove('products-grid', 'products-wrap');
  wrap.innerHTML = `
    <div class="gallery-experience ${isOffers ? 'offers-gallery-experience' : ''}">
      ${renderSectionIntro(type)}
      <div class="gallery-view" id="galleryView"></div>
    </div>`;

  const galleryEl = wrap.querySelector('#galleryView');

  if (!safeImages.length) {
    galleryEl.innerHTML = `<div class="gallery-empty">لسه مفيش صور مضافة هنا.</div>`;
    return;
  }

  galleryEl.innerHTML = safeImages.map((item, i) => {
    const url = isOffers ? (item.image || item.imageUrl || '') : item;
    if (!url) return '';

    if (isOffers && !item.photoOnly) {
      const title = item.titleAr || item.titleEn || '';
      const desc = item.descriptionAr || item.description || '';
      const price = item.discountPrice ?? '';
      const old = item.originalPrice ?? '';
      const pct = offerDiscountPercentPublic(item);
      const action = safeOfferActionUrl(item.ctaAction);
      const countdownEnd = item.countdownEnabled && item.endAt ? new Date(item.endAt).getTime() : NaN;
      const details = (title || desc || price !== '' || old !== '' || item.badge || item.subText || pct != null || item.limited || action || Number.isFinite(countdownEnd)) ? `
        <div class="offer-gallery-details">
          ${item.badge ? `<div class="offer-gallery-badge">${escapeHtml(item.badge)}</div>` : ''}
          ${title ? `<div class="offer-gallery-title">${escapeHtml(title)}</div>` : ''}
          ${desc ? `<div class="offer-gallery-desc">${escapeHtml(desc)}</div>` : ''}
          ${item.subText ? `<div class="offer-gallery-desc">${escapeHtml(item.subText)}</div>` : ''}
          ${(price !== '' || old !== '' || pct != null) ? `<div class="offer-gallery-price">
            ${old !== '' ? `<span class="offer-gallery-old">${escapeHtml(old)} AED</span>` : ''}
            ${price !== '' ? `<strong>${escapeHtml(price)} AED</strong>` : ''}
            ${pct != null ? `<span class="offer-gallery-discount">خصم ${escapeHtml(pct)}%</span>` : ''}
          </div>` : ''}
          ${item.limited ? `<div class="offer-gallery-limited">⚡ كمية محدودة</div>` : ''}
          ${Number.isFinite(countdownEnd) && countdownEnd > Date.now() ? `<div class="offer-gallery-countdown">⏳ <span data-offer-countdown-end="${countdownEnd}"></span></div>` : ''}
          ${action && item.ctaText ? `<a class="offer-gallery-cta" href="${escapeHtml(action)}" ${/^https?:/i.test(action) ? 'target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(item.ctaText)}</a>` : ''}
        </div>` : '';
      return `<div class="gallery-item offer-gallery-item has-offer-details" data-idx="${i}"><img src="${escapeHtml(cldOptimize(url, 700))}" alt="" loading="${i < EAGER_COUNT ? 'eager' : 'lazy'}" decoding="async"/>${details}</div>`;
    }

    return `<div class="gallery-item ${isOffers ? 'offer-gallery-item' : ''}" data-idx="${i}"><img src="${escapeHtml(cldOptimize(url, 700))}" alt="" loading="${i < EAGER_COUNT ? 'eager' : 'lazy'}" decoding="async"/></div>`;
  }).join('');

  galleryEl.querySelectorAll('img').forEach(img => setupImageLoading(img, fallbackImg));
  if (isOffers) {
    updateOfferCountdowns(galleryEl);
    if (galleryEl.querySelector('[data-offer-countdown-end]')) {
      if (offersCountdownTimer) clearInterval(offersCountdownTimer);
      offersCountdownTimer = setInterval(() => updateOfferCountdowns(galleryEl), 1000);
    }
  }
  galleryEl.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = +item.dataset.idx;
      if (isOffers) {
        const offer = safeImages[index];
        openImageMenu(cldOptimize(offer.image || offer.imageUrl || '', 1200), offer.titleAr || offer.titleEn || '', safeImages.map(o => cldOptimize(o.image || o.imageUrl || '', 1200)), index);
      } else {
        openImageMenu(cldOptimize(safeImages[index], 1200), '', safeImages.map(u => cldOptimize(u, 1200)), index);
      }
    });
  });
  galleryEl.querySelectorAll('.offer-gallery-cta').forEach(btn => {
    btn.addEventListener('click', (e) => e.stopPropagation());
  });

  if (galleryObserver) galleryObserver.disconnect();
  galleryObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        galleryObserver.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -60px 0px', threshold: 0.05 });
  galleryEl.querySelectorAll('.gallery-item').forEach(item => galleryObserver.observe(item));
}

/* ══════════════════════════════════════
   عروضنا — نفس معرض الصور بالضبط
   مع تفاصيل اختيارية لكل عرض.
══════════════════════════════════════ */
function renderOffersShowcase(wrap) {
  const items = (liveState.offers || [])
    .filter(o => o.visible !== false)
    .filter(o => offerIsLive(o))
    .sort((a, b) => {
      const af = a.featured ? 0 : 1;
      const bf = b.featured ? 0 : 1;
      if (af !== bf) return af - bf;
      return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
    });

  renderGalleryView(wrap, items, { type: 'offers' });
}

function openCategory(catId) {
  const cat = liveState.categories.find(c => c.id === catId);
  if (!cat) {
    // ده بالظبط اللي كان بيخلي الزرار "ميت" من غير أي رسالة قبل كده.
    // دلوقتي بيبان في بانر تحت، وبيحاول يجيب البيانات تاني تلقائيًا.
    showKioskError('القسم ده مش لاقيه في البيانات الحالية (id: ' + catId + ') — بحاول أحدّث البيانات...');
    fetchMenuData();
    return;
  }
  currentCategoryId = catId;

  const innerView = document.getElementById('view-inner');
  const isGallery = cat.displayType === 'gallery';
  const isOffers = cat.displayType === 'offers';
  innerView.classList.toggle('gallery-mode', isGallery);
  innerView.classList.toggle('offers-mode', isOffers);
  document.getElementById('galleryBackBtn').style.display = (isGallery || isOffers) ? 'flex' : 'none';

  document.getElementById('inner-emoji').textContent = cat.emoji || '🍽️';
  document.getElementById('inner-title').textContent = cat.name;
  const bannerImg = document.getElementById('inner-banner');
  bannerImg.classList.remove('img-loaded');
  bannerImg.src = cldOptimize(cat.bannerImageUrl || cat.imageUrl, 900);
  setupImageLoading(bannerImg, fallbackImg);
  const innerTagEl = document.getElementById('inner-tag');
  const isWesternSweets = (cat.name || '').includes('حلويات غربية');
  innerTagEl.textContent = cat.tag || (isWesternSweets ? 'Baked with Love, Since Forever' : '');
  innerTagEl.classList.toggle('no-bg', isWesternSweets);
  const galleryLabel = document.getElementById('galleryViewLabel');
  if (galleryLabel) galleryLabel.textContent = cat.name || '';

  const wrap = document.getElementById('products-grid');

  if (sectionObserver) { sectionObserver.disconnect(); sectionObserver = null; }
  if (galleryObserver) { galleryObserver.disconnect(); galleryObserver = null; }
  teardownOffersShowcase();

  if (isOffers) {
    wrap.classList.remove('products-wrap', 'products-grid');
    renderOffersShowcase(wrap);
  } else if (isGallery) {
    renderGalleryView(wrap, cat.galleryImages || [], { type: 'gallery' });
  } else {
    const items = (liveState.products[catId] || []);
    if (cat.sections && cat.sections.length) {
      renderSectionedCategory(wrap, cat, items);
    } else {
      wrap.classList.remove('products-wrap');
      wrap.classList.add('products-grid');
      fillProductsGrid(wrap, items);
    }
  }

  document.getElementById('view-home').classList.remove('active');
  document.getElementById('view-inner').classList.add('active');
  window.scrollTo(0, 0);
}
window.openCategory = openCategory;

let imageMenuReturnView = 'view-home';
let galleryNavImages = [];
let galleryNavIndex = 0;

function renderImageMenuFrame() {
  const photo = document.getElementById('image-menu-photo');
  photo.classList.remove('img-loaded');
  photo.src = galleryNavImages[galleryNavIndex] || '';
  setupImageLoading(photo, fallbackImg);
  const multi = galleryNavImages.length > 1;
  const counter = document.getElementById('image-menu-counter');
  const prevBtn = document.getElementById('imgNavPrev');
  const nextBtn = document.getElementById('imgNavNext');
  if (counter) { counter.style.display = multi ? 'block' : 'none'; counter.textContent = multi ? `${galleryNavIndex + 1} / ${galleryNavImages.length}` : ''; }
  if (prevBtn) prevBtn.style.display = multi ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = multi ? 'flex' : 'none';
}

function navImageMenu(dir) {
  if (galleryNavImages.length < 2) return;
  galleryNavIndex = (galleryNavIndex + dir + galleryNavImages.length) % galleryNavImages.length;
  renderImageMenuFrame();
}
window.navImageMenu = navImageMenu;

/* imagesList + index اختياريين — لو اتبعتوا، بيبقى فيه تنقل بين أكتر من صورة (زي المعرض) */
function openImageMenu(imgUrl, title, imagesList, index) {
  imageMenuReturnView = document.getElementById('view-inner').classList.contains('active') ? 'view-inner' : 'view-home';
  galleryNavImages = (Array.isArray(imagesList) && imagesList.length) ? imagesList : [imgUrl];
  galleryNavIndex = Number.isInteger(index) ? ((index % galleryNavImages.length) + galleryNavImages.length) % galleryNavImages.length : 0;

  document.getElementById('view-image').classList.toggle('gallery-lightbox', galleryNavImages.length > 1);
  document.getElementById('image-title').textContent = title || '';
  renderImageMenuFrame();

  document.getElementById('view-home').classList.remove('active');
  document.getElementById('view-inner').classList.remove('active');
  document.getElementById('view-image').classList.add('active');
  window.scrollTo(0, 0);
}
window.openImageMenu = openImageMenu;

function closeImageMenu() {
  document.getElementById('view-image').classList.remove('active');
  document.getElementById(imageMenuReturnView).classList.add('active');
  window.scrollTo(0, 0);
  if (imageMenuReturnView === 'view-home') setTimeout(checkScrollIndicator, 200);
}
window.closeImageMenu = closeImageMenu;

/* سحب باللمس بين صور المعرض — سحب لليسار = التالي، لليمين = السابق (زي أي عارض صور) */
(function setupImageMenuSwipe() {
  const wrap = document.querySelector('.image-menu-wrap');
  if (!wrap) return;
  let startX = 0, startY = 0, tracking = false;
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; tracking = true;
  }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      navImageMenu(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
})();

function goHome() {
  productReturnHome = false;
  if (sectionObserver) { sectionObserver.disconnect(); sectionObserver = null; }
  teardownOffersShowcase();
  document.getElementById('view-inner').classList.remove('active');
  document.getElementById('view-image').classList.remove('active');
  document.getElementById('view-product').classList.remove('active');
  document.getElementById('view-home').classList.add('active');
  window.scrollTo(0, 0);
  setTimeout(checkScrollIndicator, 200);
}
window.goHome = goHome;

/* ══════════════════════════════════════
   صفحة تفاصيل الصنف
══════════════════════════════════════ */
let currentProductFav = false;

function findProductById(id) {
  for (const catId in liveState.products) {
    const found = (liveState.products[catId] || []).find(p => p.id === id);
    if (found) return found;
  }
  return null;
}

function openProduct(id) {
  const item = findProductById(id);
  if (!item) return;
  currentProductFav = false;

  document.getElementById('pd-fav-btn').textContent = '🤍';
  document.getElementById('pd-fav-btn').classList.remove('active');
  const heroImg = document.getElementById('pd-hero-img');
  heroImg.classList.remove('img-loaded');
  heroImg.src = cldOptimize(item.imageUrl, 800);
  setupImageLoading(heroImg, fallbackImg);

  document.getElementById('pd-name').textContent = item.name;
  const hasSizePrices = item.sizePrices && item.sizePrices.length;
  document.getElementById('pd-price').innerHTML = hasSizePrices
    ? `${item.sizePrices.map(s => `${escapeHtml(s.name || '')} ${escapeHtml(s.price)}`).join(' / ')} <span class="prod-currency">AED</span>`
    : ((item.price !== undefined && item.price !== null) ? `${escapeHtml(item.price)}<span class="prod-currency">AED</span>` : '—');

  const sizePricesBlock = document.getElementById('pd-sizeprices-block');
  if (hasSizePrices) {
    document.getElementById('pd-sizeprices-list').innerHTML = item.sizePrices.map(s =>
      `<div class="pd-sizeprice-row"><span class="pd-sizeprice-name">${escapeHtml(s.name || '')}</span><span class="pd-sizeprice-value">${escapeHtml(s.price)} <span class="prod-currency">AED</span></span></div>`
    ).join('');
    sizePricesBlock.style.display = 'block';
  } else {
    sizePricesBlock.style.display = 'none';
  }

  const ratingRow = document.getElementById('pd-rating-row');
  if (item.rating) {
    const full = Math.round(item.rating);
    document.getElementById('pd-stars').textContent = '★'.repeat(full) + '☆'.repeat(5 - full);
    document.getElementById('pd-rating-num').textContent = `(${item.rating})`;
    ratingRow.style.display = 'flex';
  } else {
    ratingRow.style.display = 'none';
  }

  let chipsHtml = '';
  if (item.sizes && item.sizes.length) chipsHtml += `<div class="prod-sizes">${item.sizes.map(s => `<span class="prod-size-chip">${escapeHtml(s)}</span>`).join('')}</div>`;
  if (item.flavors && item.flavors.length) chipsHtml += `<div class="prod-flavors">${item.flavors.map(f => `<span class="prod-flavor-chip">${escapeHtml(f)}</span>`).join('')}</div>`;
  if (item.manaeshTypes && item.manaeshTypes.length) chipsHtml += `<div class="manaesh-types">${item.manaeshTypes.map(t => `<span class="manaesh-chip">${escapeHtml(t)}</span>`).join('')}</div>`;
  document.getElementById('pd-chips').innerHTML = chipsHtml;

  const n = item.nutrition;
  const nutritionBlock = document.getElementById('pd-nutrition-block');
  if (n && (n.calories || n.protein || n.fat || n.carb)) {
    const grid = document.getElementById('pd-nutrition-grid');
    grid.innerHTML = [
      n.calories != null ? `<div class="pd-nutri-item"><div class="pd-nutri-value">${escapeHtml(n.calories)}</div><div class="pd-nutri-label">سعرة حرارية</div></div>` : '',
      n.protein != null ? `<div class="pd-nutri-item"><div class="pd-nutri-value">${escapeHtml(n.protein)}g</div><div class="pd-nutri-label">بروتين</div></div>` : '',
      n.fat != null ? `<div class="pd-nutri-item"><div class="pd-nutri-value">${escapeHtml(n.fat)}g</div><div class="pd-nutri-label">دهون</div></div>` : '',
      n.carb != null ? `<div class="pd-nutri-item"><div class="pd-nutri-value">${escapeHtml(n.carb)}g</div><div class="pd-nutri-label">كارب</div></div>` : '',
    ].join('');
    nutritionBlock.style.display = 'block';
  } else {
    nutritionBlock.style.display = 'none';
  }

  const descBlock = document.getElementById('pd-desc-block');
  if (item.description) {
    document.getElementById('pd-desc').textContent = item.description;
    descBlock.style.display = 'block';
  } else {
    descBlock.style.display = 'none';
  }

  productReturnHome = document.getElementById('view-home').classList.contains('active');
  if (productReturnHome) homeScrollY = window.scrollY;
  document.querySelectorAll('.menu-view.active').forEach(v => v.classList.remove('active'));
  document.getElementById('view-product').classList.add('active');
  window.scrollTo(0, 0);
}
window.openProduct = openProduct;

function closeProduct() {
  document.getElementById('view-product').classList.remove('active');
  if (productReturnHome) {
    productReturnHome = false;
    document.getElementById('view-home').classList.add('active');
    window.scrollTo(0, homeScrollY || 0);
    setTimeout(checkScrollIndicator, 200);
    return;
  }
  document.getElementById('view-inner').classList.add('active');
  setTimeout(checkScrollIndicator, 200);
}
window.closeProduct = closeProduct;

function toggleProductFav() {
  currentProductFav = !currentProductFav;
  const btn = document.getElementById('pd-fav-btn');
  btn.textContent = currentProductFav ? '❤️' : '🤍';
  btn.classList.toggle('active', currentProductFav);
}
window.toggleProductFav = toggleProductFav;

/* ══════════════════════════════════════
   الصفحة الرئيسية: سلايدر الهيرو + البحث + درج التنقل + البانر الترويجي + زر الرجوع للأعلى
   كل المحتوى جاي من liveState.heroSettings (مستند siteSettings/hero) — مفيش حاجة hardcoded.
══════════════════════════════════════ */
const reducedMotionMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
function hsSafeHref(u) {
  const s = String(u || '').trim();
  return /^(https?:\/\/|mailto:|tel:|\.\/|\/(?!\/)|#)/i.test(s) ? s : '';
}

/* ── Hero slider ── */
const hsState = { sig: '', idx: 0, n: 0, timer: null, paused: false, root: null };
function hsActiveSlides() {
  const c = liveState.heroSettings || {};
  if (c.enabled === false || !Array.isArray(c.slides)) return [];
  return c.slides.filter(s => s && s.enabled !== false && s.imageUrl);
}
function hsStop() { if (hsState.timer) { clearInterval(hsState.timer); hsState.timer = null; } }
function hsStart() {
  hsStop();
  if (hsState.n < 2 || reducedMotionMQ.matches) return;            // reduced motion → manual navigation only
  const c = liveState.heroSettings || {};
  const ms = Math.max(2, Math.min(20, Number(c.sliderInterval) || 5)) * 1000;
  hsState.timer = setInterval(() => {
    if (hsState.paused || document.hidden) return;
    const v = document.getElementById('view-home');
    if (!v || !v.classList.contains('active')) return;             // don't rotate while another view is open
    hsGo(hsState.idx + 1, false);
  }, ms);
}
function hsGo(i, user) {
  const r = hsState.root;
  if (!r || !hsState.n) return;
  hsState.idx = (i + hsState.n) % hsState.n;
  r.querySelectorAll('.hs-slide').forEach((el, k) => {
    const on = k === hsState.idx;
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-hidden', on ? 'false' : 'true');
    el.inert = !on;
  });
  r.querySelectorAll('.hs-dot').forEach((d, k) => {
    d.classList.toggle('is-active', k === hsState.idx);
    d.setAttribute('aria-current', k === hsState.idx ? 'true' : 'false');
  });
  if (user) hsStart();                                              // restart the countdown after a manual move
}
function hsAttachControls(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('[data-hs]') : null;
    if (!b) return;
    const k = b.dataset.hs;
    if (k === 'next') hsGo(hsState.idx + 1, true);                  // RTL: the left arrow goes forward
    else if (k === 'prev') hsGo(hsState.idx - 1, true);
    else if (k === 'dot') hsGo(Number(b.dataset.i) || 0, true);
  });
  root.addEventListener('mouseenter', () => { hsState.paused = true; });
  root.addEventListener('mouseleave', () => { hsState.paused = false; });
  root.addEventListener('focusin', () => { hsState.paused = true; });
  root.addEventListener('focusout', () => { hsState.paused = false; });
  let sx = 0, sy = 0, tracking = false;
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('a,button')) return;
    sx = e.clientX; sy = e.clientY; tracking = true; hsState.paused = true;
  });
  const end = (e, cancel) => {
    if (!tracking) return;
    tracking = false; hsState.paused = !!(e.pointerType === 'mouse' && root.matches(':hover'));
    if (cancel) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) hsGo(hsState.idx + (dx < 0 ? 1 : -1), true);
  };
  root.addEventListener('pointerup', (e) => end(e, false));
  root.addEventListener('pointercancel', (e) => end(e, true));
}
/* returns true when the slider is in charge of the hero (≥1 active slide); false → legacy single-image hero */
function renderHeroSlider(hero) {
  const slides = hsActiveSlides();
  const c = liveState.heroSettings || {};
  let root = document.getElementById('heroSlider');
  if (!slides.length) {
    if (root) { hsStop(); root.remove(); hsState.sig = ''; hsState.root = null; hsState.n = 0; }
    hero.classList.remove('hero-slider-on', 'hs-fit-contain');
    return false;
  }
  hero.classList.remove('hero-fit-contain', 'hero-fit-cover', 'hero-fit-fill');
  hero.classList.add('hero-slider-on');
  try { localStorage.setItem('anwarHeroUrl', cldOptimize(String(slides[0].imageUrl), 1400)); } catch (e) {}   // next visit preloads the first slide
  hero.classList.toggle('hs-fit-contain', c.sliderFit === 'contain');
  hero.style.setProperty('--hs-ratio', String(c.sliderRatio || '16/9').replace('/', ' / '));
  const sig = JSON.stringify([slides, c.sliderInterval]);
  if (root && hsState.sig === sig) return true;                     // nothing changed → keep the current slide, no flicker
  hsState.sig = sig;
  if (!root) {
    root = document.createElement('div');
    root.id = 'heroSlider'; root.className = 'hs';
    root.setAttribute('role', 'region'); root.setAttribute('aria-roledescription', 'carousel'); root.setAttribute('aria-label', 'صور أنوار لبنان');
    hero.insertBefore(root, hero.firstChild);
    hsAttachControls(root);
  }
  hsState.root = root; hsState.n = slides.length;
  hsState.idx = Math.min(hsState.idx, slides.length - 1);
  const slidesHtml = slides.map((s, i) => {
    const href = (s.buttonLabel && hsSafeHref(s.buttonUrl)) ? hsSafeHref(s.buttonUrl) : '';
    const hasCap = !!(s.title || s.subtitle || href);
    const cap = hasCap ? `<div class="hs-cap hero-slide-caption">${s.title ? `<div class="hs-title">${escapeHtml(s.title)}</div>` : ''}${s.subtitle ? `<div class="hs-sub">${escapeHtml(s.subtitle)}</div>` : ''}${href ? `<a class="hs-btn" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.buttonLabel)}</a>` : ''}</div>` : '';
    return `<div class="hs-slide${i === hsState.idx ? ' is-active' : ''}" role="group" aria-roledescription="slide" aria-label="${i + 1} / ${slides.length}" aria-hidden="${i === hsState.idx ? 'false' : 'true'}"${i === hsState.idx ? '' : ' inert'}>
      <img class="hs-img" src="${escapeHtml(cldOptimize(s.imageUrl, 1400))}" alt="${escapeHtml(s.title || '')}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"/>${hasCap ? '<div class="hs-shade"></div>' : ''}${cap}</div>`;
  }).join('');
  const nav = slides.length > 1
    ? `<button class="hs-arrow hs-next" type="button" data-hs="next" aria-label="الصورة التالية"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
       <button class="hs-arrow hs-prev" type="button" data-hs="prev" aria-label="الصورة السابقة"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
       <div class="hs-dots">${slides.map((_, i) => `<button class="hs-dot${i === hsState.idx ? ' is-active' : ''}" type="button" data-hs="dot" data-i="${i}" aria-label="الصورة ${i + 1}" aria-current="${i === hsState.idx ? 'true' : 'false'}"></button>`).join('')}</div>`
    : '';
  root.innerHTML = `<div class="hs-slides">${slidesHtml}</div>${nav}`;
  hsStart();
  return true;
}

/* ── البانر الترويجي (بيظهر بس لو متفعّل وفيه صورة) ── */
function renderPromoBanner() {
  const el = document.getElementById('homePromo');
  if (!el) return;
  const b = (liveState.heroSettings && liveState.heroSettings.promoBanner) || {};
  if (!(b.enabled === true && b.imageUrl)) { el.hidden = true; el.innerHTML = ''; return; }
  const href = hsSafeHref(b.linkUrl);
  const img = `<img class="promo-img" src="${escapeHtml(cldOptimize(String(b.imageUrl), 1600))}" alt="" loading="lazy" decoding="async"/>`;
  el.innerHTML = href
    ? `<a class="promo-banner" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="عرض ترويجي">${img}</a>`
    : `<div class="promo-banner">${img}</div>`;
  el.hidden = false;
  const im = el.querySelector('img');
  if (im) im.addEventListener('error', () => { el.hidden = true; }, { once: true });   // broken image → no empty box
}

/* ── البحث ── */
const normAr = s => String(s || '').toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
let productReturnHome = false, homeScrollY = 0;
function runHomeSearch() {
  const input = document.getElementById('homeSearchInput');
  if (!input) return;
  const raw = input.value;
  const q = normAr(raw);
  const clearBtn = document.getElementById('homeSearchClear');
  if (clearBtn) clearBtn.hidden = !raw;
  const grid = document.getElementById('homeGrid'), res = document.getElementById('homeSearchResults');
  const home = document.getElementById('view-home');
  if (!grid || !res || !home) return;
  const cards = Array.from(grid.querySelectorAll('.cat-card'));
  home.classList.toggle('is-searching', !!q);
  if (!q) { cards.forEach(c => c.classList.remove('search-hide')); res.hidden = true; res.innerHTML = ''; return; }
  let catHits = 0;
  cards.forEach(c => {
    const cat = liveState.categories[Number(c.dataset.catIdx)];
    const hit = !!(cat && normAr(cat.name).includes(q));
    c.classList.toggle('search-hide', !hit);
    if (hit) catHits++;
  });
  const items = [];
  for (const cat of liveState.categories) {
    for (const p of (liveState.products[cat.id] || [])) {
      if (!p) continue;
      if (normAr(p.name).includes(q) || normAr(p.description).includes(q)) items.push(p);
      if (items.length >= 60) break;
    }
    if (items.length >= 60) break;
  }
  res.innerHTML = '';
  if (items.length) {
    const wrap = document.createElement('div');
    wrap.className = 'products-grid home-search-grid';
    items.forEach(it => wrap.appendChild(buildProductCard(it, false)));
    res.appendChild(wrap);
  } else if (!catHits) {
    const empty = document.createElement('div');
    empty.className = 'home-search-empty';
    empty.innerHTML = '<div class="hse-ic">🔎</div><div class="hse-t">ما لقينا أي صنف بهذا الاسم</div><div class="hse-s">جرّب كلمة ثانية أو امسح البحث لعرض كل الأقسام</div>';
    res.appendChild(empty);
  }
  res.hidden = res.childNodes.length === 0;
}
(function initHomeSearch() {
  const input = document.getElementById('homeSearchInput');
  if (!input) return;
  let raf = 0;
  input.addEventListener('input', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(runHomeSearch); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { input.value = ''; runHomeSearch(); e.stopPropagation(); }
    else if (e.key === 'Enter') input.blur();                         // hide the on-screen keyboard
  });
  document.getElementById('homeSearchClear')?.addEventListener('click', () => { input.value = ''; runHomeSearch(); input.focus(); });
})();

/* ── درج التنقل (الهامبرجر) ── */
const NAV_IC = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  wa: '<path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5z"/><path d="M9 9c.3 2.2 2.3 4.2 4.6 4.6l1.2-1.3-1.8-1-.8.6a3.3 3.3 0 0 1-1.5-1.5l.6-.8-1-1.8L9 9z"/>'
};
const navIcon = k => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_IC[k]}</svg>`;
function renderNavDrawer() {
  const list = document.getElementById('navDrawerList');
  if (!list) return;
  const dl = (liveState.heroSettings && liveState.heroSettings.drawerLinks) || {};
  const gallery = (liveState.categories || []).find(c => c && c.displayType === 'gallery');
  const items = [
    `<button class="nav-item-btn" type="button" data-nav="home">${navIcon('home')}<span>الرئيسية</span></button>`,
    `<button class="nav-item-btn" type="button" data-nav="categories">${navIcon('grid')}<span>كل الأقسام</span></button>`,
    `<button class="nav-item-btn" type="button" data-nav="search">${navIcon('search')}<span>البحث</span></button>`
  ];
  if (gallery) items.push(`<button class="nav-item-btn" type="button" data-nav="gallery" data-id="${escapeHtml(String(gallery.id))}">${navIcon('image')}<span>معرض الصور</span></button>`);
  // contact items only appear when the admin has configured them (nothing is invented)
  if (dl.locationUrl) items.push(`<a class="nav-item-btn" href="${escapeHtml(dl.locationUrl)}" target="_blank" rel="noopener noreferrer">${navIcon('pin')}<span>موقعنا</span></a>`);
  if (dl.phone) items.push(`<a class="nav-item-btn" href="tel:${escapeHtml(dl.phone)}">${navIcon('phone')}<span>تواصل معنا</span></a>`);
  if (dl.whatsapp) items.push(`<a class="nav-item-btn" href="https://wa.me/${escapeHtml(dl.whatsapp)}" target="_blank" rel="noopener noreferrer">${navIcon('wa')}<span>واتساب</span></a>`);
  list.innerHTML = items.join('');
}
let drawerLastFocus = null;
function openNavDrawer() {
  const d = document.getElementById('navDrawer'), bd = document.getElementById('navBackdrop');
  if (!d || !bd || d.classList.contains('open')) return;
  drawerLastFocus = document.activeElement;
  d.inert = false; d.setAttribute('aria-hidden', 'false');
  bd.hidden = false;
  document.documentElement.classList.add('drawer-open');
  document.getElementById('navMenuBtn')?.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => requestAnimationFrame(() => { d.classList.add('open'); bd.classList.add('show'); }));
  setTimeout(() => { const f = d.querySelector('.nav-item-btn'); if (f) f.focus(); }, 60);
}
function closeNavDrawer() {
  const d = document.getElementById('navDrawer'), bd = document.getElementById('navBackdrop');
  if (!d || !bd || !d.classList.contains('open')) return;
  d.classList.remove('open'); bd.classList.remove('show');
  document.documentElement.classList.remove('drawer-open');
  document.getElementById('navMenuBtn')?.setAttribute('aria-expanded', 'false');
  const done = () => { if (!d.classList.contains('open')) { bd.hidden = true; d.inert = true; d.setAttribute('aria-hidden', 'true'); } };
  if (reducedMotionMQ.matches) done(); else setTimeout(done, 320);
  if (drawerLastFocus && drawerLastFocus.focus) { try { drawerLastFocus.focus({ preventScroll: true }); } catch (e) {} }
}
(function initNavDrawer() {
  const d = document.getElementById('navDrawer');
  if (!d) return;
  document.getElementById('navMenuBtn')?.addEventListener('click', openNavDrawer);
  document.getElementById('navDrawerClose')?.addEventListener('click', closeNavDrawer);
  document.getElementById('navBackdrop')?.addEventListener('click', closeNavDrawer);
  document.addEventListener('keydown', (e) => {
    if (!d.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeNavDrawer(); return; }
    if (e.key !== 'Tab') return;                                    // keep keyboard focus inside the open drawer
    const f = Array.from(d.querySelectorAll('button,a[href]')).filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.getElementById('navDrawerList')?.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('.nav-item-btn') : null;
    if (!b) return;
    const act = b.dataset.nav;
    if (!act) { closeNavDrawer(); return; }                          // external link (location / call / WhatsApp)
    drawerLastFocus = null; closeNavDrawer();
    setTimeout(() => {
      if (act === 'home') safeInvoke(goHome);
      else if (act === 'categories') { safeInvoke(goHome); const g = document.getElementById('homeGrid'); if (g) g.scrollIntoView({ behavior: reducedMotionMQ.matches ? 'auto' : 'smooth', block: 'start' }); }
      else if (act === 'search') {
        safeInvoke(goHome);
        const s = document.getElementById('homeSearch'), i = document.getElementById('homeSearchInput');
        if (s) s.scrollIntoView({ behavior: reducedMotionMQ.matches ? 'auto' : 'smooth', block: 'center' });
        if (i) i.focus({ preventScroll: true });
      }
      else if (act === 'gallery') safeInvoke(openCategory, String(b.dataset.id || ''));
    }, reducedMotionMQ.matches ? 0 : 120);
  });
  // the logo (top-right) goes to the homepage; the existing 3-tap admin gesture on it keeps working
  document.getElementById('logoTapTarget')?.addEventListener('click', (e) => { e.preventDefault(); safeInvoke(goHome); });
})();

/* لو ملف اللوجو (logo.png) مش موجود: الدايرة بتعرض حرف «أ» بدل أيقونة صورة مكسورة — والرابط بيشتغل عادي */
(function initLogoFallback() {
  const img = document.querySelector('#logoTapTarget img');
  if (!img) return;
  const fb = () => { const l = img.closest('.kt-logo'); if (l) l.classList.add('no-logo'); };
  img.addEventListener('error', fb);
  if (img.complete && img.naturalWidth === 0) fb();
})();

/* ── زر الرجوع للأعلى ── */
(function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  btn.hidden = false;                                                // visibility is handled by the .show class (fade)
  let tick = false;
  const update = () => { tick = false; btn.classList.toggle('show', window.scrollY > 320); };   // ≈ once the hero has scrolled away
  window.addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(update); } }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducedMotionMQ.matches ? 'auto' : 'smooth' }));
  update();
})();

/* ── إعادة رسم كل حاجة بعد كل تحديث بيانات ── */
let lastRenderSig = null;
function dataSignature() {
  try {
    const timed = (liveState.offers || []).some(o => o && (o.startAt || o.endAt)); // offers can expire with time
    return JSON.stringify([liveState.categories, liveState.products, liveState.offers, liveState.heroSettings, liveState.seoSettings, liveState.isAdmin, timed ? Math.floor(Date.now() / 60000) : 0]);
  } catch (e) { return null; }
}
function renderAll() {
  // The 2-minute poll / tab-focus refetch usually returns identical data. Re-rendering then re-creates every <img>
  // (flicker, re-decoding, scroll jump to top) for nothing, so skip it.
  const sig = dataSignature();
  if (sig !== null && sig === lastRenderSig) return;
  lastRenderSig = sig;
  applyPublicSeo(liveState.seoSettings);
  renderHero();
  renderHomeGrid();
  renderNavDrawer();
  // لو المستخدم واقف جوه قسم مفتوح، حدّثه كمان بنفس اللحظة
  if (currentCategoryId && document.getElementById('view-inner').classList.contains('active')) {
    openCategory(currentCategoryId);
  }
}

/* ── مؤشر الاتصال ── */
function onConnectionChange(isOnline) {
  const dot = document.getElementById('connStatusDot');
  if (!dot) return;
  dot.classList.toggle('offline', !isOnline);
}

setCallbacks({ onRefresh: renderAll, onConnection: onConnectionChange });
// If the first Firestore fetch already finished before this module registered its callback (fast cache / fast network),
// nothing would be drawn until the next 2-minute poll — draw now.
if (liveState.lastGoodAt) renderAll();
window.addEventListener('hero-settings-updated', renderHero);
window.addEventListener('hero-settings-updated', () => { renderPromoBanner(); renderNavDrawer(); });

/* ══════════════════════════════════════
   وضع الكيوسك — بدء / شاشة كاملة / رجوع تلقائي بعد خمول
══════════════════════════════════════ */
window.startKiosk = function () {
  document.getElementById('kioskStartOverlay').classList.add('hidden');
  const el = document.documentElement;
  const reqFS = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (reqFS) { try { reqFS.call(el); } catch (e) {} }
};

const KIOSK_IDLE_MS = 60000;
let kioskIdleTimer = null;
function resetKioskIdleTimer() {
  if (kioskIdleTimer) clearTimeout(kioskIdleTimer);
  kioskIdleTimer = setTimeout(() => {
    const overlay = document.getElementById('adminOverlay');
    if (overlay && overlay.classList.contains('show')) return;
    goHome();
  }, KIOSK_IDLE_MS);
}
['click', 'touchstart', 'pointerdown', 'scroll'].forEach(evt => {
  window.addEventListener(evt, () => { resetKioskIdleTimer(); }, { passive: true });
});
resetKioskIdleTimer();

/* ══════════════════════════════════════
   دخول الأدمن — 3 لمسات على اللوجو تفتح لوحة التحكم المنفصلة
══════════════════════════════════════ */
function setupLogoTapGesture() {
  const logoEl = document.getElementById('logoTapTarget');
  if (!logoEl) return; // element must exist before attaching the listener

  // Prevent duplicate listeners if this script/init runs more than once.
  if (logoEl.dataset.tapGestureAttached === 'true') return;
  logoEl.dataset.tapGestureAttached = 'true';

  let logoTapCount = 0;
  let logoTapTimer = null;

  function registerLogoTap() {
    logoTapCount++;
    if (logoTapTimer) clearTimeout(logoTapTimer);
    logoTapTimer = setTimeout(() => { logoTapCount = 0; }, 1500);

    if (logoTapCount >= 3) {
      logoTapCount = 0;
      if (logoTapTimer) { clearTimeout(logoTapTimer); logoTapTimer = null; }
      if (typeof window.openAdminOverlay === 'function') {
        window.openAdminOverlay();
      }
    }
  }

  // Some embedded/older tablet browsers expose `window.PointerEvent` but
  // don't reliably dispatch pointer events, so we can't just trust feature
  // detection alone. Instead we listen for BOTH 'pointerup' (best for
  // touchscreens) and 'click' (always supported), and use a short-lived
  // flag to swallow the 'click' that a browser fires right after a
  // pointerup for the same physical tap. This means:
  //  - If pointerup fires correctly -> it counts the tap, and the
  //    following click (if any) is ignored, so the tap isn't counted twice.
  //  - If pointerup never fires on a given device -> the plain click still
  //    counts the tap, so the gesture keeps working either way.
  let suppressNextClick = false;
  let suppressResetTimer = null;

  logoEl.addEventListener('pointerup', (e) => {
    // Ignore non-primary mouse buttons (e.g. right-click) as a tap.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressNextClick = true;
    if (suppressResetTimer) clearTimeout(suppressResetTimer);
    // Safety valve: if no 'click' follows (varies by browser), don't let a
    // stuck flag block a later, unrelated tap.
    suppressResetTimer = setTimeout(() => { suppressNextClick = false; }, 400);
    registerLogoTap();
  });

  logoEl.addEventListener('click', () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      if (suppressResetTimer) { clearTimeout(suppressResetTimer); suppressResetTimer = null; }
      return; // this click is just the compatibility echo of the pointerup above
    }
    registerLogoTap();
  });
}

// The logo element may not exist yet if this script runs before the DOM
// has finished parsing (e.g. loaded in <head> without 'defer'). Wait for
// DOMContentLoaded in that case; otherwise attach right away.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupLogoTapGesture);
} else {
  setupLogoTapGesture();
}

/* ══════════════════════════════════════
   البداية
══════════════════════════════════════ */
(async function init() {
  // firebase-app.js owns the initial fetch through its single auth-state
  // listener. Doing another fetch here can race with the auth callback and
  // let a public (non-admin) snapshot overwrite the admin snapshot.
  startPolling();
  setTimeout(checkScrollIndicator, 600);
})();
