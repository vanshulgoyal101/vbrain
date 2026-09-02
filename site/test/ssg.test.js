import { describe, it, expect } from 'vitest';
import {
  urlForPath, filePathFor, escapeHtml, metaDescription, pageTitle, rewriteLinks, stripLeadingH1,
  renderRobots, renderHeaders, renderSitemap, breadcrumbJsonLd, articleJsonLd, htmlShell,
  urlForSection, filePathForSection, sectionGroups, renderFeed, addHeadingIds, tocHtml,
} from '../src/ssg.js';

const BASE = 'https://vbrain.example.com';

describe('urlForPath', () => {
  it('maps README to home and notes to clean URLs (no .html)', () => {
    expect(urlForPath('README.md')).toBe('/');
    expect(urlForPath('projects/pixelpaws.md')).toBe('/projects/pixelpaws');
    expect(urlForPath('now.md')).toBe('/now');
  });
});

describe('filePathFor', () => {
  it('writes README to index.html and notes to <path>.html', () => {
    expect(filePathFor('README.md')).toBe('index.html');
    expect(filePathFor('projects/pixelpaws.md')).toBe('projects/pixelpaws.html');
  });
});

describe('escapeHtml', () => {
  it('escapes the dangerous characters', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    expect(escapeHtml(null)).toBe('');
  });
  it('coerces non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
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
    expect(rewriteLinks(html, 'projects/x.md')).toContain('href="/now"');
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
  it('leaves mailto links unchanged', () => {
    expect(rewriteLinks('<a href="mailto:x@y.com">m</a>', 'README.md')).toBe('<a href="mailto:x@y.com">m</a>');
  });
});

describe('renderRobots', () => {
  it('allows all and references the sitemap', () => {
    const r = renderRobots(BASE);
    expect(r).toContain('Allow: /');
    expect(r).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  });
  it('points AI agents at llms.txt', () => {
    expect(renderRobots(BASE)).toContain(`${BASE}/llms.txt`);
  });
});

describe('renderHeaders', () => {
  it('sets strict security headers and script-src none', () => {
    const h = renderHeaders();
    expect(h).toContain('/*');
    expect(h).toContain('X-Content-Type-Options: nosniff');
    expect(h).toContain("script-src 'none'");
    expect(h).toContain('Cache-Control: public, max-age=86400');
  });
});

describe('stripLeadingH1', () => {
  it('removes the leading H1 and keeps the body', () => {
    expect(stripLeadingH1('# Title\n\nbody here')).toBe('body here');
  });
  it('is a no-op when there is no leading H1', () => {
    expect(stripLeadingH1('no title\nbody')).toBe('no title\nbody');
  });
});

describe('renderSitemap', () => {
  it('emits a loc per entry with home priority 1.0', () => {
    const xml = renderSitemap([{ path: 'README.md' }, { path: 'now.md', lastmod: '2026-09-02' }], BASE);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain(`<loc>${BASE}/</loc>`);
    expect(xml).toContain(`<loc>${BASE}/now</loc>`);
    expect(xml).toContain('<lastmod>2026-09-02</lastmod>');
    expect(xml).toContain('<priority>1.0</priority>');
  });
  it('accepts an explicit url + priority (section hubs)', () => {
    const xml = renderSitemap([{ url: '/projects/', priority: '0.5' }], BASE);
    expect(xml).toContain(`<loc>${BASE}/projects/</loc>`);
    expect(xml).toContain('<priority>0.5</priority>');
  });
});

describe('section hubs', () => {
  it('maps a section to its URL and output file', () => {
    expect(urlForSection('projects')).toBe('/projects/');
    expect(filePathForSection('projects')).toBe('projects/index.html');
  });
  it('groups note paths by section, skipping root notes', () => {
    const g = sectionGroups(['README.md', 'now.md', 'projects/b.md', 'projects/a.md', 'learnings/x.md']);
    expect([...g.keys()].sort()).toEqual(['learnings', 'projects']);
    expect(g.get('projects')).toEqual(['projects/a.md', 'projects/b.md']); // sorted
  });
});

describe('addHeadingIds', () => {
  it('slugs h2/h3 so sections are deep-linkable', () => {
    const out = addHeadingIds('<h2>Testing &amp; CI</h2><p>x</p><h3>Why it matters</h3>');
    expect(out).toContain('<h2 id="testing-ci">');
    expect(out).toContain('<h3 id="why-it-matters">');
  });
  it('leaves other headings and inline markup alone', () => {
    const out = addHeadingIds('<h1>Title</h1><h2>A <code>b</code></h2>');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<code>b</code>');
  });
  it('de-duplicates repeated headings', () => {
    const out = addHeadingIds('<h2>Notes</h2><h2>Notes</h2>');
    expect(out).toContain('id="notes"');
    expect(out).toContain('id="notes-2"');
  });
});

describe('tocHtml', () => {
  const body = addHeadingIds(['One', 'Two', 'Three', 'Four'].map((h) => `<h2>${h}</h2>`).join(''));
  it('builds a linked contents list once there are enough headings', () => {
    const toc = tocHtml(body);
    expect(toc).toContain('<summary>On this page</summary>');
    expect(toc).toContain('<a href="#one">One</a>');
    expect(toc).toContain('<a href="#four">Four</a>');
  });
  it('is empty for short notes', () => {
    expect(tocHtml(addHeadingIds('<h2>Only</h2>'))).toBe('');
  });
});

describe('renderFeed', () => {  const xml = renderFeed(
    [{ url: BASE + '/now', title: 'Now & Then', description: 'Current focus', date: '2026-09-02T10:00:00Z' }],
    { base: BASE, siteName: 'vbrain', description: 'A second brain' },
  );
  it('is valid RSS with a self link and an item', () => {
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain(`<atom:link href="${BASE}/feed.xml" rel="self"`);
    expect(xml).toContain(`<link>${BASE}/now</link>`);
    expect(xml).toContain('<guid isPermaLink="true">');
  });
  it('escapes titles and emits an RFC-822 pubDate', () => {
    expect(xml).toContain('<title>Now &amp; Then</title>');
    expect(xml).toMatch(/<pubDate>\w{3}, \d{2} \w{3} \d{4}/);
  });
  it('omits pubDate when the date is unknown', () => {
    const noDate = renderFeed([{ url: BASE + '/x', title: 'X', description: 'd' }], { base: BASE, siteName: 's', description: 'd' });
    expect(noDate).not.toContain('<pubDate>');
  });
});

describe('JSON-LD', () => {
  it('breadcrumb includes home + section + title', () => {
    const ld = breadcrumbJsonLd('projects/pixelpaws.md', '# PixelPaws\n> x', BASE, 'vbrain');
    const names = ld.itemListElement.map((i) => i.name);
    expect(names).toEqual(['vbrain', 'projects', 'PixelPaws']);
  });  it('article carries headline + author + description', () => {
    const ld = articleJsonLd('now.md', '# Now\n> **TL;DR** — current focus.', BASE, 'vbrain', 'Alex');
    expect(ld['@type']).toBe('TechArticle');
    expect(ld.headline).toBe('Now');
    expect(ld.author.name).toBe('Alex');
    expect(ld.dateModified).toBeUndefined(); // omitted when unknown
  });
  it('article includes git dates when provided', () => {
    const ld = articleJsonLd('now.md', '# Now', BASE, 'vbrain', 'Alex', { published: '2026-01-01T00:00:00Z', modified: '2026-09-02T00:00:00Z' });
    expect(ld.datePublished).toBe('2026-01-01T00:00:00Z');
    expect(ld.dateModified).toBe('2026-09-02T00:00:00Z');
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
  it('has a skip link and color-scheme for a11y', () => {
    expect(doc).toContain('<a class="skip" href="#main">Skip to content</a>');
    expect(doc).toContain('<meta name="color-scheme" content="dark light" />');
  });
  it('can emit noindex', () => {
    expect(htmlShell({ title: 'T', description: 'D', canonical: BASE, base: BASE, bodyHtml: '', indexable: false }))
      .toContain('noindex, nofollow');
  });
  it('defaults og:type to website and can switch to article with a modified time', () => {
    expect(doc).toContain('<meta property="og:type" content="website" />');
    const art = htmlShell({
      title: 'T', description: 'D', canonical: BASE, base: BASE, bodyHtml: '',
      ogType: 'article', modified: '2026-09-02T00:00:00Z',
    });
    expect(art).toContain('<meta property="og:type" content="article" />');
    expect(art).toContain('<meta property="article:modified_time" content="2026-09-02T00:00:00Z" />');
  });
  it('links the RSS feed only when given one', () => {
    expect(doc).not.toContain('application/rss+xml');
    expect(htmlShell({ title: 'T', description: 'D', canonical: BASE, base: BASE, bodyHtml: '', feedUrl: BASE + '/feed.xml' }))
      .toContain(`<link rel="alternate" type="application/rss+xml" title="T" href="${BASE}/feed.xml" />`);
  });
  it('advertises a raster OG image with dimensions (social platforms reject SVG)', () => {
    expect(doc).toContain(`<meta property="og:image" content="${BASE}/og.png" />`);
    expect(doc).toContain('<meta property="og:image:width" content="1200" />');
    expect(doc).toContain('<meta property="og:image:height" content="630" />');
    expect(doc).toContain('<meta property="og:image:alt" content="T" />');
  });
});
