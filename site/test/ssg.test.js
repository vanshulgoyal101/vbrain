import { describe, it, expect } from 'vitest';
import {
  urlForPath, escapeHtml, metaDescription, pageTitle, rewriteLinks,
  renderRobots, renderSitemap, breadcrumbJsonLd, articleJsonLd, htmlShell,
} from '../src/ssg.js';

const BASE = 'https://vbrain.example.com';

describe('urlForPath', () => {
  it('maps README to home and notes to .html', () => {
    expect(urlForPath('README.md')).toBe('/');
    expect(urlForPath('projects/pixelpaws.md')).toBe('/projects/pixelpaws.html');
    expect(urlForPath('now.md')).toBe('/now.html');
  });
});

describe('escapeHtml', () => {
  it('escapes the dangerous characters', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('metaDescription', () => {
  it('uses the TL;DR blockquote, stripped of the label + markdown', () => {
    const md = '# Title\n\n> **TL;DR** — A cozy pet game in the browser. Fun.\n\nbody';
    expect(metaDescription(md)).toBe('A cozy pet game in the browser. Fun.');
  });
  it('falls back to the first real paragraph', () => {
    expect(metaDescription('# Title\n\nJust a plain first line here.')).toBe('Just a plain first line here.');
  });
  it('truncates long text with an ellipsis', () => {
    const long = '# T\n> ' + 'x'.repeat(300);
    const out = metaDescription(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('pageTitle', () => {
  it('is the site name for home, else "Title — Site"', () => {
    expect(pageTitle('# Home', 'README.md', 'vbrain')).toBe('vbrain');
    expect(pageTitle('# My Note', 'now.md', 'vbrain')).toBe('My Note — vbrain');
  });
});

describe('rewriteLinks', () => {
  it('rewrites relative .md links to static URLs', () => {
    const html = 'see <a href="../now.md">now</a>';
    expect(rewriteLinks(html, 'projects/x.md')).toContain('href="/now.html"');
  });
  it('marks external links noopener + target', () => {
    const out = rewriteLinks('<a href="https://x.com">x</a>', 'README.md');
    expect(out).toContain('rel="noopener"');
    expect(out).toContain('target="_blank"');
  });
  it('leaves anchors and absolute paths alone', () => {
    expect(rewriteLinks('<a href="#top">t</a>', 'README.md')).toBe('<a href="#top">t</a>');
    expect(rewriteLinks('<a href="/x.html">t</a>', 'README.md')).toBe('<a href="/x.html">t</a>');
  });
});

describe('renderRobots', () => {
  it('allows all and references the sitemap', () => {
    const r = renderRobots(BASE);
    expect(r).toContain('Allow: /');
    expect(r).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  });
});

describe('renderSitemap', () => {
  it('emits a loc per entry with home priority 1.0', () => {
    const xml = renderSitemap([{ path: 'README.md' }, { path: 'now.md', lastmod: '2026-09-02' }], BASE);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain(`<loc>${BASE}/</loc>`);
    expect(xml).toContain(`<loc>${BASE}/now.html</loc>`);
    expect(xml).toContain('<lastmod>2026-09-02</lastmod>');
    expect(xml).toContain('<priority>1.0</priority>');
  });
});

describe('JSON-LD', () => {
  it('breadcrumb includes home + section + title', () => {
    const ld = breadcrumbJsonLd('projects/pixelpaws.md', '# PixelPaws\n> x', BASE, 'vbrain');
    const names = ld.itemListElement.map((i) => i.name);
    expect(names).toEqual(['vbrain', 'projects', 'PixelPaws']);
  });
  it('article carries headline + author + description', () => {
    const ld = articleJsonLd('now.md', '# Now\n> **TL;DR** — current focus.', BASE, 'vbrain', 'Alex');
    expect(ld['@type']).toBe('TechArticle');
    expect(ld.headline).toBe('Now');
    expect(ld.author.name).toBe('Alex');
  });
});

describe('htmlShell', () => {
  const doc = htmlShell({
    title: 'T', description: 'D', canonical: BASE + '/now.html', base: BASE,
    bodyHtml: '<main>hi</main>', jsonLd: [{ '@type': 'X' }],
  });
  it('is indexable by default with canonical + OG + JSON-LD', () => {
    expect(doc).toContain('<meta name="robots" content="index, follow" />');
    expect(doc).toContain(`<link rel="canonical" href="${BASE}/now.html" />`);
    expect(doc).toContain('property="og:title"');
    expect(doc).toContain('application/ld+json');
    expect(doc).toContain('<main>hi</main>');
  });
  it('can emit noindex', () => {
    expect(htmlShell({ title: 'T', description: 'D', canonical: BASE, base: BASE, bodyHtml: '', indexable: false }))
      .toContain('noindex, nofollow');
  });
});
