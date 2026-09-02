// Pure helpers for the static public-site generator (SSG). No IO, no DOM here, so
// every function is unit-testable; the build script (scripts/build-site.mjs) does
// the file reads/writes and markdown rendering. This lets a brain export itself as
// a fast, fully-indexable static site (each note becomes its own HTML page).

import { sectionOf, titleOf, resolvePath } from '../public/lib.js';

// A note path → the site URL path. README.md is the home page ("/").
export function urlForPath(path) {
  if (path === 'README.md') return '/';
  return '/' + path.replace(/\.md$/, '.html');
}

// Escape text for safe inclusion in HTML/attributes.
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
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
export function rewriteLinks(html, fromPath) {
  return html.replace(/href="([^"]+)"/g, (m, href) => {
    if (/^(https?:|mailto:|#|\/)/i.test(href)) {
      return /^https?:/i.test(href) ? `href="${href}" rel="noopener" target="_blank"` : m;
    }
    const clean = href.replace(/#.*$/, '');
    if (!clean.endsWith('.md')) return m;
    const resolved = resolvePath(fromPath, clean);
    return `href="${escapeHtml(urlForPath(resolved))}"`;
  });
}

// robots.txt — public site is fully indexable and points at the sitemap.
export function renderRobots(base) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
}

// sitemap.xml from a list of { path, lastmod? }.
export function renderSitemap(entries, base) {
  const urls = entries.map(({ path, lastmod }) => {
    const loc = base + urlForPath(path);
    const lm = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
    const pri = path === 'README.md' ? '1.0' : '0.7';
    return `  <url>\n    <loc>${escapeHtml(loc)}</loc>${lm}\n    <priority>${pri}</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
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

// TechArticle JSON-LD for a note page.
export function articleJsonLd(path, md, base, siteName, author) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: titleOf(md, path),
    description: metaDescription(md),
    url: base + urlForPath(path),
    author: { '@type': 'Person', name: author },
    isPartOf: { '@type': 'WebSite', name: siteName, url: base + '/' },
  };
}

// The full HTML document with SEO meta, Open Graph, Twitter, canonical, and any
// JSON-LD blocks. `indexable=false` emits a noindex robots tag.
export function htmlShell({ title, description, canonical, base, bodyHtml, jsonLd = [], ogImage = '/og.svg', indexable = true, themeColor = '#0c0d12' }) {
  const ld = jsonLd.filter(Boolean).map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n  ');
  const robots = indexable ? 'index, follow' : 'noindex, nofollow';
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
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(base + ogImage)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(base + ogImage)}" />
  <link rel="icon" type="image/svg+xml" href="/brain.svg" />
  <link rel="stylesheet" href="/site.css" />
  ${ld}
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
