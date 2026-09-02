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

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { titleOf, sectionOf, graphData } from './public/lib.js';
import {
  urlForPath, filePathFor, escapeHtml, metaDescription, pageTitle, rewriteLinks, stripLeadingH1,
  renderRobots, renderHeaders, renderSitemap, breadcrumbJsonLd, articleJsonLd, htmlShell,
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

// inbound links (backlinks) from the note graph
const { edges } = graphData(files);
const inbound = new Map(paths.map((p) => [p, []]));
for (const e of edges) inbound.get(e.target)?.push(e.source);

const BRAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></svg>';

const nav = () => `<header class="site-nav"><nav class="wrap" aria-label="Primary"><a class="brand" href="/">${BRAND_SVG}<span>${escapeHtml(SITE_NAME)}</span></a><span class="spacer"></span><a class="navlink" href="/#notes">Notes</a><a class="navlink" href="${REPO}" rel="noopener">GitHub</a></nav></header>`;
const foot = () => `<footer class="site-foot"><div class="wrap"><span>${escapeHtml(SITE_NAME)} — an open-source second-brain engine.</span><span><a href="${REPO}" rel="noopener">Source</a> · MIT</span></div></footer>`;

// ── render one note page ─────────────────────────────────────────────────────
function renderNote(path) {
  const md = files[path];
  const body = rewriteLinks(marked.parse(md), path);
  const back = (inbound.get(path) || []).sort();
  const backHtml = back.length
    ? `<nav class="backlinks"><h2>Linked from</h2><ul>${back.map((b) => `<li><a href="${escapeHtml(urlForPath(b))}">${escapeHtml(titleOf(files[b], b))}</a></li>`).join('')}</ul></nav>`
    : '';
  const sec = sectionOf(path);
  const crumbs = `<nav class="crumbs wrap"><a href="/">${escapeHtml(SITE_NAME)}</a>${sec ? ` › ${escapeHtml(sec)}` : ''} › ${escapeHtml(titleOf(md, path))}</nav>`;
  const bodyHtml = `${nav()}${crumbs}<main id="main" class="wrap prose"><article>${body}</article>${backHtml}</main>${foot()}`;
  return htmlShell({
    title: pageTitle(md, path, SITE_NAME),
    description: metaDescription(md),
    canonical: SITE_URL + urlForPath(path),
    base: SITE_URL,
    bodyHtml,
    jsonLd: [articleJsonLd(path, md, SITE_URL, SITE_NAME, AUTHOR), breadcrumbJsonLd(path, md, SITE_URL, SITE_NAME)],
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
<main id="main" class="wrap prose">${rewriteLinks(marked.parse(stripLeadingH1(readme)), 'README.md')}</main>
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
    jsonLd: [websiteLd, appLd],
  });
}

// ── OG image (SVG, 1200×630) ─────────────────────────────────────────────────
function ogSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0c0d12"/><g transform="translate(90,250)" fill="none" stroke="#3ddc97" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M60 10a30 30 0 1 0-60 1.25 40 40 0 0 0-25 57.7 40 40 0 0 0 5.6 65.8A40 40 0 1 0 60 120Z" transform="scale(1.1)"/></g><text x="240" y="300" fill="#e7e9ee" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="86" font-weight="700">${escapeHtml(SITE_NAME)}</text><text x="242" y="370" fill="#9aa3b2" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="36">Your second brain, as an engine.</text></svg>`;
}

// ── write everything ─────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const p of paths) {
  if (p === 'README.md') continue;
  const outPath = join(OUT, filePathFor(p));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderNote(p));
}
writeFileSync(join(OUT, 'index.html'), renderLanding());
writeFileSync(join(OUT, 'sitemap.xml'), renderSitemap(paths.map((p) => ({ path: p })), SITE_URL));
writeFileSync(join(OUT, 'robots.txt'), renderRobots(SITE_URL));
writeFileSync(join(OUT, '_headers'), renderHeaders());
writeFileSync(join(OUT, 'og.svg'), ogSvg());
copyFileSync(join(HERE, 'public-site.css'), join(OUT, 'site.css'));
copyFileSync(join(HERE, 'public', 'brain.svg'), join(OUT, 'brain.svg'));

console.log(`✅ built ${paths.length} pages → ${relative(process.cwd(), OUT)}  (site: ${SITE_URL})`);
