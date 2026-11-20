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

## Update — Home grid (chips bar + dish cards, 3 layouts)
- design-system.css: exact reference sizes. Desktop >=1232: 4 cols, 1074 container, gap 36/33, card 164 (img 98). Tablet 641-1231: desktop layout scaled via zoom=width/1232, card 226 (img 150). Mobile <=640: 2 cols, gap 18, padding 16, card 164/98, compact chips.
- kiosk-app.js: chips bar (search + All + categories), dish cards (featured dish per category, click opens the dish), in-place category filtering, tablet zoom.
- admin.js / firebase-app.js: new Settings section "شبكة الرئيسية" stored in siteSettings/hero.homeGrid (showChips, showSearch, allLabel, cardMode, showCategoryTag, featured{catId:productId}).
- index.html: #homeBar/#homeChips markup. service-worker.js: cache v18.

## Update — Category pages (view-inner) ported to the reference system
- index.html: view-inner markup restructured (back button + eyebrow/tag + title + item count now live inside a pg-hero-style banner; all ids kept so JS is unchanged).
- design-system.css: new "CATEGORY PAGE" block — same numbers as the home grid: desktop 4 cols / 1074 container / gap 36·33 / card 164 (img 98); tablet 641–1231 uses the desktop layout via JS zoom, card 226 (img 150); mobile ≤640 2 cols / gap 18 / padding 16 / compact chips. Section tabs = reference chips. Site header now shows on category pages (still hidden for gallery, offers and product page).
- kiosk-app.js: sets item count in #inner-sub. enhancements.js: hide-on-scroll now follows the site header. service-worker.js: cache v19.
- Cards in category grids show name + price only (sizes/flavours/notes moved to the product page) because reference cards are fixed-height.
- Gallery and offers showcases are intentionally unchanged.
