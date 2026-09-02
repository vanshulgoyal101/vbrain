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
<section>/index.html  section hub ("/projects/") listing that section's notes
404.html              real 404 (Pages serves it with a 404 status)
sitemap.xml           all pages + hubs, sitemaps.org 0.9 schema, with lastmod
feed.xml              RSS 2.0 of the 25 most recently updated notes
llms.txt              AI-crawler index (copied from the repo root)
llms-full.txt         AI-crawler full text (copied from the repo root)
robots.txt            allow all + sitemap reference + llms.txt pointer
_headers              Cloudflare Pages security headers + asset caching
og.svg                1200×630 social image
site.css              public-site stylesheet
brain.svg             favicon/logo
```

URLs are **clean** (no `.html`) — Cloudflare Pages serves `foo.html` at `/foo`, so
canonicals, internal links, and the sitemap all use the extensionless form to
avoid duplicate-content mismatches. Files are still written as `.html` on disk.

## What each page ships (SEO)

- `<title>` = *Note title — vbrain*; unique `<meta name="description">` from the note's TL;DR.
- `<link rel="canonical">`, Open Graph + Twitter Card tags, `theme-color`.
- `index, follow` robots (vs. the private app's `noindex`).
- **JSON-LD**: `TechArticle` + `BreadcrumbList` per note; `WebSite` + `SoftwareApplication`
  on the landing; `CollectionPage` + `BreadcrumbList` on each section hub.
- **Freshness**: `datePublished`/`dateModified` come from the note's **git history**
  (first and last commit touching the file), and feed `<lastmod>` in the sitemap.
  Falls back to file mtime when no git history is available.
- `og:type` is `article` on notes (with `article:modified_time`), `website` elsewhere.
- Semantic HTML (`header`/`main`/`article`/`nav`/`footer`), a "Linked from" backlinks
  section, a "More in ‹section›" sibling list, and breadcrumbs — internal linking
  that search engines reward, and no note is a dead end.

## Crawlability

Two things that are easy to get wrong on a static host, both handled here:

- **No soft 404s.** Without a `404.html`, Cloudflare Pages answers unknown URLs with
  the landing page at HTTP 200 — search engines see infinite duplicate pages. The
  generator emits a real `404.html` (noindex), which Pages serves with a 404 status.
- **Breadcrumbs point at real pages.** The `BreadcrumbList` links `/projects/`, so
  every section gets a genuine hub page (also listed in the sitemap) instead of a
  crumb that resolves to a soft 404.

## Architecture

- Pure, unit-tested logic in [`../src/ssg.js`](../src/ssg.js) (URLs, meta, sitemap,
  robots, JSON-LD, the HTML shell, link rewriting) — see [`../test/ssg.test.js`](../test/ssg.test.js).
- IO + Markdown rendering in [`../build-site.mjs`](../build-site.mjs) (uses `marked`).
- Note→note Markdown links are rewritten to their static URLs; external links get
  `rel="noopener" target="_blank"`.

## Deploy (Cloudflare Pages, from CI)

The site is built **and published by CI** (`.github/workflows/ci.yml`, job
`public site build`) on every push to `main`. The job publishes exactly the
artifact it just verified, so the live site can't drift behind `main` the way a
one-off manual upload does.

One-time setup — add these in the GitHub repo settings:

| Kind | Name | Value |
|------|------|-------|
| Secret | `CLOUDFLARE_API_TOKEN` | API token with the **Cloudflare Pages: Edit** permission |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID |
| Variable | `CF_PAGES_PROJECT` | Pages project name (optional; defaults to `vbrain`) |

Until the token exists the job still builds and verifies the site, then logs a
notice instead of publishing — so CI is never red just because deploys aren't
wired up yet.

`SITE_URL` is set in the workflow (`https://vbrain.vanshul.com`); the Pages
project itself needs no build configuration in this mode, since CI uploads a
prebuilt `site/dist`.

### Two gotchas that silently break the deploy

- **Don't publish by hand.** A one-off `wrangler pages deploy dist` publishes a
  snapshot that never updates again; the site then drifts behind `main` with no
  error anywhere. If unknown URLs return the landing page at HTTP 200 instead of a
  404, you are looking at a stale deploy.
- **`marked` must stay in `dependencies`, not `devDependencies`.** If you use the
  Pages *Git integration* instead of CI, Pages builds with `NODE_ENV=production`,
  so `npm ci` prunes devDependencies — a build-time import of a devDependency fails
  there while working locally. CI reproduces this by installing with
  `NODE_ENV=production`.

CI checks out with **full clone depth**: the generator reads git history for
`datePublished`/`dateModified`, and a shallow clone collapses every note to the
same date (it still builds — it just loses the freshness signal).

## Notes / future

- The OG image is an SVG. Some crawlers prefer PNG; a rasterized `og.png` is a
  potential upgrade (needs an image lib).
- Section index pages (`/projects/`) are a potential add; section READMEs are
  currently served at `/projects/README`.
- The static pages ship **zero client JS**, so `_headers` sets `script-src 'none'`;
  JSON-LD is inline data (crawlers read it from source regardless).
