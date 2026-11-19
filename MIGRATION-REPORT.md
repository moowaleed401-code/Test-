# Anwar Lebanon — Full UI/UX Migration Report

## Phase 1 — Audit (what exists in the codebase)
Public (single-page, view switching inside #page-menu): Home · Category/Products/Gallery/Offers (view-inner) · Product details (view-product) · Image viewer (view-image) · Start overlay · Search (home).
Admin (#adminOverlay): Login · Overview · Categories · Products · Offers · Western-gallery · Media library · Settings hub → Hero · Hero slider · Promo banner · Drawer links · SEO · Backup/Restore.
NOT in the codebase (so not migrated, nothing invented): User/permission management, Activity log, standalone About/Contact/Location pages.

## Phase 2 — Design language extracted from the reference
Palette red #8c0f14 + deep green #123a30 + ink #1c2b27 on white · Playfair Display (Latin headings) + Cairo/Figtree · radii 10/12/14/20 · card shadow `0 6px 16px rgba(0,0,0,.2),0 0 0 1px #eee` · pill chips · white header with burger+clock / centred nav / brand · white drawer · red primary + outlined secondary buttons.

## Phase 3 — Design system (single source: design-system.css)
Tokens: colour, type, spacing, radius, elevation, motion, breakpoints, focus ring.
Legacy-variable bridge: old public + admin variables now resolve to the new tokens (so un-rewritten screens inherit the identity); hard-coded admin blues/purples were migrated to tokens in index.html/enhancements.css.
Shared components: Header, Nav, Drawer, Buttons (primary/secondary/danger/ghost/disabled/focus), Cards, Chips, Search field, Form controls, Toggle, Tables, Modal/backdrop, Notification (toast), Skeleton, Empty state, Social icon, Page container/hero/section/grid (pg-*), Segmented tabs + Repeater (admin).
Motion: page entrance, staggered card/grid reveals, drawer slide, press/hover feedback, smooth scroll — all disabled under prefers-reduced-motion.

## Phases 4–6 — Migrated screens
Public: shared site header (new) · Home (hero slider, search, 2/3/4-column grid, promo band) · Category/products (chips, cards) · Product details · Navigation drawer · Back-to-top · NEW Branches page · NEW Catering page (+ WhatsApp quote request) · NEW Follow-Us page.
Admin: Login · Overview · Categories · Products · Offers · Western-gallery · Media · Settings hub · Hero · Slider · Promo · Drawer links · SEO · Backup · NEW "صفحات الموقع" editor (Branches / Catering / Follow Us).

## Files changed
design-system.css (new) · index.html · kiosk-app.js · firebase-app.js (pages schema + validation only; exports unchanged) · admin.js · enhancements.js · enhancements.css · service-worker.js (cache v17, new file listed).

## Data model
No new collections. New content lives in the existing `siteSettings/hero` document under `pages` (sanitised in mergeHeroSettings), so existing Firestore rules and Backup/Restore already cover it.

## Tests (headless Chromium, Firebase/Cloudinary replaced by stand-ins that run the real validation code)
Public 60/60 · Admin slider/promo/drawer/hero-form regression 52/52 · New pages + admin editor 38/38 · all 7 admin views + 3 settings sections load with 0 JS errors at 1280 and 390px · widths 320/360/390/768/1280/1920 no overflow · RTL · reduced motion · missing logo fallback.
Not tested: real Firebase/Cloudinary/Firestore rules, real phones, Safari/Firefox.


## Phase 7 — Product-card UI code port (2026-11-19)
- Added `reference-ui-migration.css`, a production-scoped port of the supplied reference `.card`, `.grid`, `.chips`, and `.chip` rules to the live `.prod-card`, `.products-grid`, and `.section-tab` components.
- Applied the reference card proportions, image heights, typography, price colors, chip treatment, radii, shadows, desktop/tablet/mobile breakpoints, and dark-surface equivalents to products inside categories and nested sections.
- Preserved the existing `kiosk-app.js` product renderer and its dynamic Firebase data, section tabs, optional sizes/flavours/descriptions, wide/tall/photo-only cards, gallery, and product-detail interactions.
- Loaded the migration stylesheet after `design-system.css` and added it to the service-worker shell cache; bumped the shell cache key to v18.
- Validation: JavaScript syntax checks pass for kiosk-app.js, firebase-app.js, admin.js, enhancements.js, and service-worker.js.
- Packaging note: the supplied ZIP references `boot.js` and `manifest.webmanifest` from `index.html` / the service worker, but neither file is present in the supplied archive. These were not fabricated or silently replaced.


## Phase 8 — Second-pass QA and fixes (2026-11-19)
- Fixed a literal `\\n` accidentally embedded between stylesheet tags in `index.html`.
- Removed the dangling `boot.js` script reference (the file was not present and no boot.js implementation was supplied).
- Added a valid local `manifest.webmanifest` so the existing PWA manifest link no longer returns 404.
- Added `logo-fallback.svg` as a bundled neutral brand mark and updated default logo references, replacing references to the absent `logo.png`; uploaded/custom logo URLs remain supported.
- Removed nonexistent files from the service-worker precache list, added the manifest and fallback logo, and bumped the cache to v19.
- Renamed a duplicate inline style element ID to keep document IDs unique.
- Validation: all JavaScript files pass `node --check`; all CSS files parse without syntax errors; HTML local references and duplicate IDs checked.


## Phase 9 — Third-pass service-worker hardening (2026-11-19)
- Reworked fetch handling to register one `respondWith` promise synchronously and removed late `event.waitUntil()` calls from asynchronous callbacks.
- Added query-string-insensitive cache fallback so versioned asset URLs can still load from the precached shell while offline.
- Made cache writes best-effort: quota/storage failures no longer replace a successful network response with an offline error.
- Bumped the shell cache to `anwar-shell-v20`; old shell caches are removed on activation.
- Validation: all JS syntax checks, CSS parser checks, HTML local-reference checks, duplicate-ID checks, and ZIP integrity checks passed. Browser-based runtime testing was attempted but the execution environment blocked local Chromium navigation; Firebase/Cloudinary production integration remains unverified.


## Phase 10 — Deployment archive structure (2026-11-19)
- Corrected the ZIP packaging layout: the previous archive wrapped the website files inside an extra `anwar_review/` directory, which could cause deployment platforms expecting `index.html` at the archive root to publish the wrong directory or show a 404.
- Rebuilt the archive with `index.html`, assets, scripts, manifest, and service worker directly at the ZIP root.
- Validation: ZIP integrity checked; all expected project files are at archive root; JavaScript syntax, local HTML references, and duplicate IDs rechecked.


## Phase 8 — إصلاح شاشة بدء العرض (19 نوفمبر 2026)

- إصلاح تعارض في `design-system.css` كان يغيّر خلفية شاشة بدء الكيوسك إلى الأبيض، مع إبقاء لون النص أبيض؛ لذلك كان الشعار والعنوان غير ظاهرين على الخلفية.
- إعادة خلفية شاشة البدء إلى التدرج الأخضر وإظهار العنوان والشعار وزر البدء بألوان متباينة.
- إضافة مستمع نقر صريح لزر `بدء العرض`؛ لم يكن هناك معالج فعلي لـ `data-act="startKiosk"`، ولذلك لم يكن الزر يغلق شاشة البداية.
- جعل فشل طلب ملء الشاشة غير مؤثر على فتح الموقع؛ يستمر عرض المنيو في الوضع العادي إذا رفض المتصفح ملء الشاشة.
- تحديث إصدار الأصول إلى `20261119-2` وذاكرة Service Worker إلى `anwar-shell-v21`.
