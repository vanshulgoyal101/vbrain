// Pure helpers for the static public-site generator (SSG). No IO, no DOM here, so
// every function is unit-testable; the build script (scripts/build-site.mjs) does
// the file reads/writes and markdown rendering. This lets a brain export itself as
// a fast, fully-indexable static site (each note becomes its own HTML page).

import { sectionOf, titleOf, resolvePath, escapeHtml, slugify } from '../public/lib.js';

// Re-exported so the SSG has one obvious import surface (and one escaper).
export { escapeHtml };

// A note path → the site URL (clean, no .html — Cloudflare Pages serves and
// prefers extensionless URLs). README.md is the home page ("/").
export function urlForPath(path) {
  if (path === 'README.md') return '/';
  return '/' + path.replace(/\.md$/, '');
}

// A note path → its on-disk output file (what the SSG writes). README is the
// landing index; every other note is `<path>.html`.
export function filePathFor(path) {
  return path === 'README.md' ? 'index.html' : path.replace(/\.md$/, '.html');
}

// Section hub pages: `/projects/` etc. The BreadcrumbList links these, so they
// have to be real pages (otherwise the crumb points at a soft 404).
export function urlForSection(section) {
  return '/' + section + '/';
}

export function filePathForSection(section) {
  return section + '/index.html';
}

// Group note paths by section, in stable order. Root-level notes have no
// section and are skipped (they're already linked from the landing index).
export function sectionGroups(paths) {
  const out = new Map();
  for (const p of [...paths].sort()) {
    const sec = sectionOf(p);
    if (!sec) continue;
    if (!out.has(sec)) out.set(sec, []);
    out.get(sec).push(p);
  }
  return out;
}

// A concise meta description: the note's `> TL;DR` blockquote (label stripped),
// falling back to the first real paragraph. Collapsed + truncated to ~155 chars.
export function metaDescription(md, max = 155) {
  const lines = (md || '').split('\n');
  let text = '';
  const tldr = lines.find((l) => l.startsWith('> '));
  if (tldr) {
    text = tldr.replace(/^>\s*/, '').replace(/\*\*TL;DR\*\*\s*[—:-]*\s*/i, '');
  } else {
    text = lines.find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('>')) || '';
  }
  text = text.replace(/[*_`>#[\]]|\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

// The <title> for a page: "Note Title — Site Name" (home is just the site name).
export function pageTitle(md, path, siteName) {
  if (path === 'README.md') return siteName;
  return `${titleOf(md, path)} — ${siteName}`;
}

// Rewrite in-note markdown links (`x.md`, `../a/b.md`) to their static URLs, and
// mark external links safe. Operates on rendered HTML; leaves anchors/mailto alone.
// `known` is the set of note paths actually exported — a link to anything outside
// it (dev docs like site/README.md, which the export skips) would otherwise become
// a dead URL, so it points at the source on GitHub instead.
export function rewriteLinks(html, fromPath, known = null, repoUrl = '') {
  return html.replace(/href="([^"]+)"/g, (m, href) => {
    if (/^(https?:|mailto:|#|\/)/i.test(href)) {
      return /^https?:/i.test(href) ? `href="${href}" rel="noopener" target="_blank"` : m;
    }
    const clean = href.replace(/#.*$/, '');
    if (!clean.endsWith('.md')) return m;
    const resolved = resolvePath(fromPath, clean);
    if (known && !known.has(resolved)) {
      if (!repoUrl) return m;
      return `href="${escapeHtml(`${repoUrl}/blob/main/${resolved}`)}" rel="noopener" target="_blank"`;
    }
    return `href="${escapeHtml(urlForPath(resolved))}"`;
  });
}

// Strip the leading H1 from note markdown — the landing supplies its own <h1>
// (the hero), so rendering the README's H1 too would create a second page H1.
export function stripLeadingH1(md) {
  return (md || '').replace(/^\s*#\s+.*(?:\r?\n)+/, '');
}

// Rendered HTML → the heading's plain text. Tags go, then entities are decoded so
// slugs match the app's client-side `textContent` behaviour ("A &amp; B" → "a-b").
function headingText(inner) {
  return String(inner)
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m, e) => (
      { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }[e]
    ))
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .trim();
}

// Give every h2/h3 a stable id so sections are deep-linkable (and eligible for
// "jump to section" links in search results). Duplicate slugs get -2, -3, …
// Mirrors the app's client-side addHeadingIds so both surfaces agree.
export function addHeadingIds(html) {
  const used = new Map();
  return String(html || '').replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (m, level, inner) => {
    const base = slugify(headingText(inner));
    if (!base) return m;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    return `<h${level} id="${escapeHtml(id)}">${inner}</h${level}>`;
  });
}

// A "On this page" ToC from the h2s that addHeadingIds just tagged. Returns ''
// for short notes, where a ToC is just noise.
export function tocHtml(html, min = 4) {
  const heads = [...String(html || '').matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)]
    .map((m) => ({ id: m[1], text: headingText(m[2]) }));
  if (heads.length < min) return '';
  const items = heads.map((h) => `<li><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`).join('');
  return `<details class="toc"><summary>On this page</summary><ul>${items}</ul></details>`;
}

// robots.txt — public site is fully indexable and points at the sitemap. The
// llms.txt pointer is a comment: it's not a robots directive, just discovery.
export function renderRobots(base) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n\n# AI agents: ${base}/llms.txt (index) and ${base}/llms-full.txt (full text)\n`;
}

// Cloudflare Pages `_headers` — strict security headers site-wide (the static
// pages run zero client JS, so script-src can be 'none') + asset caching.
export function renderHeaders() {
  return [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  X-Frame-Options: DENY',
    "  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    '  Permissions-Policy: geolocation=(), microphone=(), camera=()',
    '',
    '/*.css',
    '  Cache-Control: public, max-age=86400',
    '/*.svg',
    '  Cache-Control: public, max-age=86400',
    '/*.png',
    '  Cache-Control: public, max-age=86400',
    '',
  ].join('\n');
}

// sitemap.xml from a list of { path, url?, lastmod?, priority? }. `url` overrides
// the note-derived URL so section hubs can be listed too.
export function renderSitemap(entries, base) {
  const urls = entries.map(({ path, url, lastmod, priority }) => {
    const loc = base + (url || urlForPath(path));
    const lm = lastmod ? `\n    <lastmod>${escapeHtml(lastmod)}</lastmod>` : '';
    const pri = priority || (path === 'README.md' ? '1.0' : '0.7');
    return `  <url>\n    <loc>${escapeHtml(loc)}</loc>${lm}\n    <priority>${pri}</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// RSS 2.0 feed of the most recently updated notes — discovery for readers and
// crawlers. `items` are { url, title, description, date? } already absolute.
export function renderFeed(items, { base, siteName, description }) {
  const rfc822 = (iso) => (iso ? new Date(iso).toUTCString() : '');
  const entries = items.map((it) => {
    const date = rfc822(it.date);
    return [
      '    <item>',
      `      <title>${escapeHtml(it.title)}</title>`,
      `      <link>${escapeHtml(it.url)}</link>`,
      `      <guid isPermaLink="true">${escapeHtml(it.url)}</guid>`,
      `      <description>${escapeHtml(it.description)}</description>`,
      date ? `      <pubDate>${date}</pubDate>` : '',
      '    </item>',
    ].filter(Boolean).join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(siteName)}</title>
    <link>${escapeHtml(base)}/</link>
    <description>${escapeHtml(description)}</description>
    <language>en</language>
    <atom:link href="${escapeHtml(base)}/feed.xml" rel="self" type="application/rss+xml" />
${entries}
  </channel>
</rss>
`;
}

// BreadcrumbList JSON-LD for a note page (Home › Section › Title).
export function breadcrumbJsonLd(path, md, base, siteName) {
  const items = [{ name: siteName, url: base + '/' }];
  const sec = sectionOf(path);
  if (sec) items.push({ name: sec, url: base + '/' + sec + '/' });
  if (path !== 'README.md') items.push({ name: titleOf(md, path), url: base + urlForPath(path) });
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

// TechArticle JSON-LD for a note page. Dates are ISO-8601 strings (from git) and
// are omitted when unknown — `dateModified` is a freshness signal for search.
export function articleJsonLd(path, md, base, siteName, author, dates = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: titleOf(md, path),
    description: metaDescription(md),
    url: base + urlForPath(path),
    ...(dates.published ? { datePublished: dates.published } : {}),
    ...(dates.modified ? { dateModified: dates.modified } : {}),
    author: { '@type': 'Person', name: author },
    isPartOf: { '@type': 'WebSite', name: siteName, url: base + '/' },
  };
}

// The full HTML document with SEO meta, Open Graph, Twitter, canonical, and any
// JSON-LD blocks. `indexable=false` emits a noindex robots tag.
export function htmlShell({ title, description, canonical, base, bodyHtml, jsonLd = [], ogImage = '/og.png', indexable = true, themeColor = '#0c0d12', ogType = 'website', feedUrl = '', modified = '' }) {
  const ld = jsonLd.filter(Boolean).map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n  ');
  const robots = indexable ? 'index, follow' : 'noindex, nofollow';
  const feed = feedUrl ? `\n  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(title)}" href="${escapeHtml(feedUrl)}" />` : '';
  const mod = modified ? `\n  <meta property="article:modified_time" content="${escapeHtml(modified)}" />` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="${robots}" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta name="theme-color" content="${themeColor}" />
  <meta name="color-scheme" content="dark light" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(base + ogImage)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${escapeHtml(title)}" />
  <meta property="og:site_name" content="${escapeHtml(base.replace(/^https?:\/\//, ''))}" />${mod}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(base + ogImage)}" />
  <link rel="icon" type="image/svg+xml" href="/brain.svg" />
  <link rel="stylesheet" href="/site.css" />${feed}
  ${ld}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${bodyHtml}
</body>
</html>
`;
}
