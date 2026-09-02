# Public site (SEO static build)

The brain has two faces:

| Site | Source | Audience | Indexing |
|------|--------|----------|----------|
| **brain.vanshul.com** | `vbrain-private` (real notes) | owner only | **noindex** (private, auth-gated) — correct |
| **vbrain.vanshul.com** | `vbrain` (demo notes) | the public | **fully indexable** static site |

The public site is a **static export** of the notes — every note becomes its own
pre-rendered, indexable HTML page. Static HTML ranks far better than a client-only
SPA (content is in the initial response; no JS needed to read it).

## Build

```bash
cd site
npm install                 # first time (adds marked)
npm run build:site          # -> site/dist/
SITE_URL=https://vbrain.vanshul.com npm run build:site
```

Environment overrides: `SITE_URL`, `SITE_NAME`, `SITE_AUTHOR`, `SITE_REPO`.

Output (`site/dist/`, gitignored):

```
index.html            landing page (hero + features + note index)
<note>.html           one indexable page per note (nested by folder)
sitemap.xml           all pages, sitemaps.org 0.9 schema
robots.txt            allow all + sitemap reference
og.svg                1200×630 social image
site.css              public-site stylesheet
brain.svg             favicon/logo
```

## What each page ships (SEO)

- `<title>` = *Note title — vbrain*; unique `<meta name="description">` from the note's TL;DR.
- `<link rel="canonical">`, Open Graph + Twitter Card tags, `theme-color`.
- `index, follow` robots (vs. the private app's `noindex`).
- **JSON-LD**: `TechArticle` + `BreadcrumbList` per note; `WebSite` + `SoftwareApplication` on the landing.
- Semantic HTML (`header`/`main`/`article`/`nav`/`footer`), a "Linked from" backlinks
  section, and breadcrumbs — internal linking that search engines reward.

## Architecture

- Pure, unit-tested logic in [`../src/ssg.js`](../src/ssg.js) (URLs, meta, sitemap,
  robots, JSON-LD, the HTML shell, link rewriting) — see [`../test/ssg.test.js`](../test/ssg.test.js).
- IO + Markdown rendering in [`../build-site.mjs`](../build-site.mjs) (uses `marked`).
- Note→note Markdown links are rewritten to their static URLs; external links get
  `rel="noopener" target="_blank"`.

## Deploy (Cloudflare Pages)

1. Point **vbrain.vanshul.com** at a Cloudflare Pages project for this repo.
2. Build command: `cd site && npm ci && npm run build:site`. Output dir: `site/dist`.
3. Set `SITE_URL=https://vbrain.vanshul.com` in the Pages build environment.
4. Pages serves the static files on the CDN — no Worker, no auth, no database.

## Notes / future

- The OG image is an SVG. Some crawlers prefer PNG; a rasterized `og.png` is a
  potential upgrade (needs an image lib).
- Clean URLs (`/projects/pixelpaws` without `.html`) are possible via Pages
  redirects; `.html` is fully indexable and kept for simplicity.
