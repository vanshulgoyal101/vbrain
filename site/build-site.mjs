#!/usr/bin/env node
// Static site generator for the PUBLIC site (e.g. vbrain.vanshul.com).
// Turns the brain's Markdown notes into a fast, fully-indexable static site:
// a landing page + one HTML page per note (SEO meta, Open Graph, canonical,
// TechArticle + BreadcrumbList JSON-LD), plus sitemap.xml and robots.txt.
//
//   cd site && npm run build:site            # -> site/dist/
//   SITE_URL=https://vbrain.vanshul.com npm run build:site
//
// Pure logic lives in src/ssg.js (unit-tested); this file only does IO + Markdown.

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { Resvg } from '@resvg/resvg-js';
import { titleOf, sectionOf, graphData } from './public/lib.js';
import {
  urlForPath, filePathFor, escapeHtml, metaDescription, pageTitle, rewriteLinks, stripLeadingH1,
  renderRobots, renderHeaders, renderSitemap, breadcrumbJsonLd, articleJsonLd, htmlShell, metaProblems,
  urlForSection, filePathForSection, sectionGroups, renderFeed, addHeadingIds, tocHtml, sectionReadmeOf,
} from './src/ssg.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');          // repo root (notes live here)
const OUT = join(HERE, 'dist');            // site/dist
const IGNORE = new Set(['site', 'scripts', 'node_modules', '.git', '.github']);

const SITE_URL = (process.env.SITE_URL || 'https://vbrain.vanshul.com').replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'vbrain';
const AUTHOR = process.env.SITE_AUTHOR || 'Vanshul Goyal';
const REPO = process.env.SITE_REPO || 'https://github.com/vanshulgoyal101/vbrain';

marked.setOptions({ gfm: true, breaks: false });

// ── collect notes ────────────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (dir === ROOT && IGNORE.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!IGNORE.has(name)) walk(p, acc); }
    else if (name.endsWith('.md')) acc.push(relative(ROOT, p));
  }
  return acc;
}
const paths = walk(ROOT).sort();
const files = Object.fromEntries(paths.map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]));
const KNOWN = new Set(paths);

const walkOut = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walkOut(p, acc) : acc.push(p);
  }
  return acc;
};

// inbound links (backlinks) from the note graph
const { edges } = graphData(files);
const inbound = new Map(paths.map((p) => [p, []]));
for (const e of edges) inbound.get(e.target)?.push(e.source);

// First/last commit dates per note → datePublished/dateModified + sitemap lastmod.
// Falls back to file mtime when git history isn't available (shallow clone/export).
function datesFor(path) {
  try {
    const log = execFileSync('git', ['log', '--format=%aI', '--', path], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n').filter(Boolean);
    if (log.length) return { modified: log[0], published: log[log.length - 1] };
  } catch { /* no git → mtime */ }
  const iso = statSync(join(ROOT, path)).mtime.toISOString();
  return { modified: iso, published: iso };
}
const DATES = Object.fromEntries(paths.map((p) => [p, datesFor(p)]));

// Section → its notes, for hub pages and sibling ("More in …") links.
const SECTIONS = sectionGroups(paths);
// A section README is rendered as that section's hub, so it never appears as one
// of the section's own entries.
const membersOf = (sec) => (SECTIONS.get(sec) || []).filter((p) => !sectionReadmeOf(p));
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const BRAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></svg>';

const nav = () => `<header class="site-nav"><nav class="wrap" aria-label="Primary"><a class="brand" href="/">${BRAND_SVG}<span>${escapeHtml(SITE_NAME)}</span></a><span class="spacer"></span><a class="navlink" href="/#notes">Notes</a><a class="navlink" href="${REPO}" rel="noopener">GitHub</a></nav></header>`;
const foot = () => `<footer class="site-foot"><div class="wrap"><span>${escapeHtml(SITE_NAME)} — an open-source second-brain engine.</span><span><a href="${REPO}" rel="noopener">Source</a> · MIT</span></div></footer>`;

// ── render one note page ─────────────────────────────────────────────────────
function renderNote(path) {
  const md = files[path];
  const body = addHeadingIds(rewriteLinks(marked.parse(md), path, KNOWN, REPO));
  const toc = tocHtml(body);
  const back = (inbound.get(path) || []).sort();
  const backHtml = back.length
    ? `<nav class="backlinks"><h2>Linked from</h2><ul>${back.map((b) => `<li><a href="${escapeHtml(urlForPath(b))}">${escapeHtml(titleOf(files[b], b))}</a></li>`).join('')}</ul></nav>`
    : '';
  const sec = sectionOf(path);
  // Sibling notes in the same section — internal linking so no note is a dead end.
  const siblings = membersOf(sec).filter((p) => p !== path);
  const siblingHtml = siblings.length
    ? `<nav class="siblings"><h2>More in ${escapeHtml(titleCase(sec))}</h2><ul>${siblings.map((s) => `<li><a href="${escapeHtml(urlForPath(s))}">${escapeHtml(titleOf(files[s], s))}</a></li>`).join('')}</ul></nav>`
    : '';
  const crumbs = `<nav class="crumbs wrap" aria-label="Breadcrumb"><a href="/">${escapeHtml(SITE_NAME)}</a>${sec ? ` › <a href="${escapeHtml(urlForSection(sec))}">${escapeHtml(titleCase(sec))}</a>` : ''} › ${escapeHtml(titleOf(md, path))}</nav>`;
  const bodyHtml = `${nav()}${crumbs}<main id="main" class="wrap prose">${toc}<article>${body}</article>${siblingHtml}${backHtml}</main>${foot()}`;
  return htmlShell({
    title: pageTitle(md, path, SITE_NAME),
    description: metaDescription(md),
    canonical: SITE_URL + urlForPath(path),
    base: SITE_URL,
    bodyHtml,
    ogType: 'article',
    modified: DATES[path]?.modified,
    jsonLd: [articleJsonLd(path, md, SITE_URL, SITE_NAME, AUTHOR, DATES[path]), breadcrumbJsonLd(path, md, SITE_URL, SITE_NAME)],
  });
}

// ── section hub page (/projects/) ────────────────────────────────────────────
// The breadcrumb JSON-LD points here, so these must be real, indexable pages.
// When the section has a README it IS this page — rendering it separately would
// publish two near-identical URLs competing for the same query, with the thinner
// one holding the canonical slot.
function renderSection(sec, secPaths) {
  const readmePath = `${sec}/README.md`;
  const readme = files[readmePath];
  const name = readme ? titleOf(readme, readmePath) : titleCase(sec);
  const cards = secPaths.map((p) => (
    `<li><a href="${escapeHtml(urlForPath(p))}"><span class="t">${escapeHtml(titleOf(files[p], p))}</span><span class="d">${escapeHtml(metaDescription(files[p], 90))}</span></a></li>`
  )).join('');
  const description = readme
    ? metaDescription(readme)
    : `${secPaths.length} note${secPaths.length === 1 ? '' : 's'} in ${name} — part of the ${SITE_NAME} demo brain.`;
  const intro = readme
    ? `<article>${addHeadingIds(rewriteLinks(marked.parse(stripLeadingH1(readme)), readmePath, KNOWN, REPO))}</article>`
    : `<p class="lede">${escapeHtml(description)}</p>`;
  const bodyHtml = `${nav()}
<nav class="crumbs wrap" aria-label="Breadcrumb"><a href="/">${escapeHtml(SITE_NAME)}</a> › ${escapeHtml(name)}</nav>
<main id="main" class="wrap prose"><h1>${escapeHtml(name)}</h1>${intro}
<h2>Notes in ${escapeHtml(titleCase(sec))}</h2><ul class="card-grid">${cards}</ul></main>${foot()}`;
  const listLd = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name, url: SITE_URL + urlForSection(sec), description,
    hasPart: secPaths.map((p) => ({ '@type': 'TechArticle', headline: titleOf(files[p], p), url: SITE_URL + urlForPath(p) })),
  };
  const crumbLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name, item: SITE_URL + urlForSection(sec) },
    ],
  };
  return htmlShell({
    title: `${name} — ${SITE_NAME}`, description, canonical: SITE_URL + urlForSection(sec),
    base: SITE_URL, bodyHtml, modified: readme ? DATES[readmePath]?.modified : '', jsonLd: [listLd, crumbLd],
  });
}

// ── 404 ──────────────────────────────────────────────────────────────────────
// Cloudflare Pages serves this with a real 404 status for unmatched routes;
// without it every unknown URL 200s with the landing page (a soft 404).
function renderNotFound() {
  const bodyHtml = `${nav()}<main id="main" class="wrap prose"><h1>404 — note not found</h1>
<p>That page isn't part of this brain. Try the <a href="/">home page</a> or browse <a href="/#notes">all notes</a>.</p></main>${foot()}`;
  return htmlShell({
    title: `404 — page not found — ${SITE_NAME}`, description: 'That page could not be found.',
    canonical: SITE_URL + '/404', base: SITE_URL, bodyHtml, indexable: false,
  });
}

// ── landing page (from README.md) ────────────────────────────────────────────
function renderLanding() {
  const readme = files['README.md'] || '# ' + SITE_NAME;
  const desc = metaDescription(readme);
  const featureCards = [
    ['Full-text search', 'A real BM25 engine — prefix + typo tolerance, phrase and section operators.'],
    ['Knowledge graph', 'Every note and its links, force-directed; orphan and backlink analysis.'],
    ['MCP server', 'Query and append to the brain from any AI agent (Claude, Cursor, Codex).'],
    ['Guardrails', 'A validator enforces structure, links, and a secret/PII scanner. CI-gated.'],
  ].map(([h, p]) => `<div class="feature"><h3>${escapeHtml(h)}</h3><p>${escapeHtml(p)}</p></div>`).join('');

  const indexCards = paths.filter((p) => p !== 'README.md').map((p) => (
    `<li><a href="${escapeHtml(urlForPath(p))}"><span class="t">${escapeHtml(titleOf(files[p], p))}</span><span class="d">${escapeHtml(metaDescription(files[p], 90))}</span></a></li>`
  )).join('');

  const bodyHtml = `${nav()}
<header class="hero"><div class="wrap">
  <h1>${escapeHtml(SITE_NAME)} — your second brain, as an engine</h1>
  <p class="lede">${escapeHtml(desc)}</p>
  <div class="cta"><a class="btn primary" href="#notes">Explore the demo brain</a><a class="btn" href="${REPO}" rel="noopener">View on GitHub</a></div>
</div></header>
<section class="wrap features-section"><h2>What you get</h2><div class="features">${featureCards}</div></section>
<main id="main" class="wrap prose">${rewriteLinks(marked.parse(stripLeadingH1(readme)), 'README.md', KNOWN, REPO)}</main>
<section id="notes" class="wrap notes-index"><h2>The demo brain</h2><ul class="card-grid">${indexCards}</ul></section>
${foot()}`;

  const websiteLd = { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: SITE_URL + '/', description: desc };
  const appLd = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: SITE_NAME,
    applicationCategory: 'DeveloperApplication', operatingSystem: 'Any', url: SITE_URL + '/',
    description: desc, author: { '@type': 'Person', name: AUTHOR }, license: 'https://opensource.org/licenses/MIT',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
  return htmlShell({
    title: `${SITE_NAME} — a private, AI-queryable second brain (open-source engine)`,
    description: desc, canonical: SITE_URL + '/', base: SITE_URL, bodyHtml,
    feedUrl: SITE_URL + '/feed.xml',
    jsonLd: [websiteLd, appLd],
  });
}

// ── OG image ───────────────────────────────────────────────────────
// Authored as SVG, shipped as PNG: X/LinkedIn/Facebook/Slack all refuse SVG for
// preview images, so an SVG og:image means no social card at all.
function ogSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0c0d12"/><g transform="translate(90,250)" fill="none" stroke="#3ddc97" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M60 10a30 30 0 1 0-60 1.25 40 40 0 0 0-25 57.7 40 40 0 0 0 5.6 65.8A40 40 0 1 0 60 120Z" transform="scale(1.1)"/></g><text x="240" y="300" fill="#e7e9ee" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="86" font-weight="700">${escapeHtml(SITE_NAME)}</text><text x="242" y="370" fill="#9aa3b2" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="36">Your second brain, as an engine.</text></svg>`;
}

function ogPng() {
  return new Resvg(ogSvg(), { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
}

// ── write everything ─────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const p of paths) {
  if (p === 'README.md' || sectionReadmeOf(p)) continue; // landing / section hub
  const outPath = join(OUT, filePathFor(p));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderNote(p));
}
writeFileSync(join(OUT, 'index.html'), renderLanding());

// Section hubs — real pages behind the breadcrumbs, plus internal-link hubs.
for (const sec of SECTIONS.keys()) {
  const outPath = join(OUT, filePathForSection(sec));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderSection(sec, membersOf(sec)));
}
writeFileSync(join(OUT, '404.html'), renderNotFound());

const sitemapEntries = [
  // urlForPath already maps a section README onto '/<section>/', so only sections
  // without one still need an explicit hub entry.
  ...paths.map((p) => ({ path: p, lastmod: DATES[p]?.modified })),
  ...[...SECTIONS.keys()].filter((sec) => !files[`${sec}/README.md`])
    .map((sec) => ({ url: urlForSection(sec), priority: '0.5' })),
];
writeFileSync(join(OUT, 'sitemap.xml'), renderSitemap(sitemapEntries, SITE_URL));

// Feed: newest-updated notes first.
const feedItems = paths
  .filter((p) => p !== 'README.md')
  .map((p) => ({ url: SITE_URL + urlForPath(p), title: titleOf(files[p], p), description: metaDescription(files[p]), date: DATES[p]?.modified }))
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .slice(0, 25);
writeFileSync(join(OUT, 'feed.xml'), renderFeed(feedItems, { base: SITE_URL, siteName: SITE_NAME, description: metaDescription(files['README.md'] || '') }));

writeFileSync(join(OUT, 'robots.txt'), renderRobots(SITE_URL));
writeFileSync(join(OUT, '_headers'), renderHeaders());
writeFileSync(join(OUT, 'og.png'), ogPng());
copyFileSync(join(HERE, 'public-site.css'), join(OUT, 'site.css'));
copyFileSync(join(HERE, 'public', 'brain.svg'), join(OUT, 'brain.svg'));

// llms.txt / llms-full.txt — the emerging convention for AI crawlers. They're
// generated into the repo root by scripts/gen-llms.mjs; serve them at the site
// root so agents can find the brain without scraping HTML.
for (const f of ['llms.txt', 'llms-full.txt']) {
  const src = join(ROOT, f);
  if (existsSync(src)) copyFileSync(src, join(OUT, f));
}

// Every internal link must resolve to something we actually wrote. A dead link
// is a hard 404 for crawlers, so fail the build rather than ship it.
const broken = [];
const metaPages = [];
for (const page of walkOut(OUT)) {
  if (!page.endsWith('.html')) continue;
  const html = readFileSync(page, 'utf8');
  const rel = relative(OUT, page);
  for (const [, href] of html.matchAll(/href="(\/[^"#]*)"/g)) {
    const hit = [join(OUT, href), join(OUT, `${href}.html`), join(OUT, href, 'index.html')].some(existsSync);
    if (!hit) broken.push(`${rel} → ${href}`);
  }
  // 404 is deliberately noindex, so its metadata isn't competing for anything.
  if (rel !== '404.html') {
    metaPages.push({
      path: rel,
      title: (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '',
      description: (html.match(/name="description" content="([^"]*)"/) || [])[1] || '',
    });
  }
}
const problems = [...broken.map((b) => `broken link: ${b}`), ...metaProblems(metaPages)];
if (problems.length) {
  console.error(`❌ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

console.log(`✅ built ${paths.length} pages + ${SECTIONS.size} section hubs → ${relative(process.cwd(), OUT)}  (site: ${SITE_URL})`);
