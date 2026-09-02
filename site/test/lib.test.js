import { describe, it, expect } from 'vitest';
import { sectionOf, titleOf, resolvePath, sortPaths, matches, fold, tokenize, excerpt, highlight, slugify, backlinksFor, rankHits, graphData, suggestTargets, sectionBullets, parseQuery, editDistanceLE, escapeHtml, safeUrl, relativeTime } from '../public/lib.js';

describe('sectionOf', () => {
  it('returns folder or empty for root', () => {
    expect(sectionOf('career/profile.md')).toBe('career');
    expect(sectionOf('README.md')).toBe('');
  });
});

describe('titleOf', () => {
  it('uses the H1', () => {
    expect(titleOf('# Hello World\n\ntext', 'x.md')).toBe('Hello World');
  });
  it('falls back to filename', () => {
    expect(titleOf('no heading', 'career/foo-bar.md')).toBe('foo-bar');
  });
});

describe('resolvePath', () => {
  it('resolves ../ and ./', () => {
    expect(resolvePath('career/profile.md', '../projects/pixelpaws.md')).toBe('projects/pixelpaws.md');
    expect(resolvePath('career/profile.md', './strategy.md')).toBe('career/strategy.md');
    expect(resolvePath('README.md', 'career/profile.md')).toBe('career/profile.md');
  });
});

describe('sortPaths', () => {
  it('pins FIRST names then sorts alphabetically', () => {
    const cmp = sortPaths(['README.md', 'MAP.md']);
    const arr = ['career/z.md', 'MAP.md', 'README.md', 'career/a.md'];
    expect([...arr].sort(cmp)).toEqual(['README.md', 'MAP.md', 'career/a.md', 'career/z.md']);
  });
});

describe('matches', () => {
  it('matches path, title, or body case-insensitively', () => {
    expect(matches('career/profile.md', 'PROF', '# X', titleOf)).toBe(true);
    expect(matches('a.md', 'naval', '# A\nNaval quote', titleOf)).toBe(true);
    expect(matches('a.md', 'zzz', '# A', titleOf)).toBe(false);
    expect(matches('a.md', '', '# A', titleOf)).toBe(true);
  });
  it('folds diacritics (resume matches résumé)', () => {
    expect(matches('career/resume.md', 'resume', '# Résumé\ncontent', titleOf)).toBe(true);
  });
});

describe('fold', () => {
  it('lowercases and strips Latin diacritics length-preservingly', () => {
    expect(fold('Résumé')).toBe('resume');
    expect(fold('Café — Señor')).toBe('cafe — senor');
    expect(fold('Résumé').length).toBe('Résumé'.length); // 1:1 so snippet indices align
  });
});

describe('tokenize', () => {
  it('splits into folded word tokens', () => {
    expect(tokenize('The PixelPaws, résumé!')).toEqual(['the', 'pixelpaws', 'resume']);
  });
  it('returns [] for empty', () => expect(tokenize('   ')).toEqual([]));
});

describe('excerpt', () => {
  it('windows around the earliest matching term (multi-word)', () => {
    const text = 'a'.repeat(120) + ' the brown fox jumps ' + 'b'.repeat(120);
    const ex = excerpt(text, 'fox brown');
    expect(ex).toContain('brown');
    expect(ex.startsWith('…')).toBe(true);
  });
  it('matches through diacritics', () => {
    expect(excerpt('my Résumé lives here', 'resume')).toContain('Résumé');
  });
  it('falls back to the head when nothing matches', () => {
    expect(excerpt('hello world', 'zzz', 5)).toBe('hello');
  });
  it('anchors on the fuzzy-matched word behind a typo', () => {
    const ex = excerpt('x'.repeat(100) + ' deployment steps ' + 'y'.repeat(100), 'deploment');
    expect(ex).toContain('deployment');
  });
});

describe('highlight', () => {
  it('wraps every query term and escapes HTML', () => {
    const h = highlight('brown fox <b> brown', 'brown fox');
    expect(h).toContain('<mark>brown</mark>');
    expect(h).toContain('<mark>fox</mark>');
    expect(h).toContain('&lt;b&gt;'); // escaped, not a real tag
  });
  it('does not match substrings (on ≠ lion)', () => {
    expect(highlight('a lion', 'on')).not.toContain('<mark>');
  });
  it('highlights the real word behind a typo', () => {
    expect(highlight('our deployment guide', 'deploment')).toContain('<mark>deployment</mark>');
  });
});

describe('slugify', () => {
  it('makes anchor-safe ids', () => {
    expect(slugify('The New Leverage!')).toBe('the-new-leverage');
    expect(slugify('A/B  test')).toBe('ab-test');
  });
});

describe('backlinksFor', () => {
  it('finds files that link to a target', () => {
    const files = {
      'a.md': '# A\nsee [b](b.md) and [self](a.md)',
      'b.md': '# B',
      'c.md': '# C\n[link](b.md)',
    };
    expect(backlinksFor('b.md', files, resolvePath).sort()).toEqual(['a.md', 'c.md']);
    expect(backlinksFor('a.md', files, resolvePath)).toEqual([]);
  });
});

describe('rankHits', () => {
  const files = {
    'a.md': '# Pixel stuff\nnothing here',
    'b.md': '# Other\npixel pixel pixel pixel',
    'c.md': '# Nope\nunrelated',
  };
  it('ranks by score with title/frequency boosts', () => {
    const hits = rankHits(files, 'pixel', titleOf);
    expect(hits.map((h) => h.path)).toEqual(['a.md', 'b.md']); // title field boost > body frequency
    expect(hits.every((h) => h.score > 0)).toBe(true);
  });
  it('returns nothing for a blank query', () => {
    expect(rankHits(files, '   ', titleOf)).toEqual([]);
  });
  it('supports multiple terms (coverage bonus favours matching more terms)', () => {
    const hits = rankHits({ x: '# X\nalpha beta', y: '# Y\nalpha alpha alpha' }, 'alpha beta', titleOf);
    expect(hits[0].path).toBe('x');
  });
  it('token-matches, not substring (no "on" inside "lion")', () => {
    expect(rankHits({ a: '# A\na lion roars' }, 'on', titleOf)).toEqual([]);
  });
  it('folds diacritics when ranking', () => {
    const hits = rankHits({ r: '# Résumé\nmy résumé', o: '# Other\nnope' }, 'resume', titleOf);
    expect(hits[0].path).toBe('r');
  });
});

describe('parseQuery', () => {
  it('splits phrases, terms, excludes and section', () => {
    const q = parseQuery('"ad brain" traction -pixel section:career');
    expect(q.phrases).toEqual(['ad brain']);
    expect(q.terms).toEqual(['traction']);
    expect(q.excludes).toEqual(['pixel']);
    expect(q.section).toBe('career');
  });
  it('supports -"phrase" exclusions', () => {
    expect(parseQuery('-"dead end"').excludePhrases).toEqual(['dead end']);
  });
});

describe('editDistanceLE', () => {
  it('computes bounded edit distance', () => {
    expect(editDistanceLE('cat', 'car', 1)).toBe(1);
    expect(editDistanceLE('deploment', 'deployment', 2)).toBe(1);
    expect(editDistanceLE('abc', 'xyz', 1)).toBe(2); // exceeds → max+1
  });
});

describe('rankHits — operators & fuzzy', () => {
  it('tolerates a typo via fuzzy fallback', () => {
    const files = { 'a.md': '# A\ndeployment checklist', 'b.md': '# B\nunrelated text' };
    expect(rankHits(files, 'deploment', titleOf)[0].path).toBe('a.md'); // typo of "deployment"
  });
  it('supports "exact phrase" as an AND filter', () => {
    const files = { 'a.md': '# A\nthe quick brown fox', 'b.md': '# B\nbrown then quick' };
    expect(rankHits(files, '"quick brown"', titleOf).map((h) => h.path)).toEqual(['a.md']);
  });
  it('supports -exclude', () => {
    const files = { 'a.md': '# A\npixel panels', 'b.md': '# B\npixel battery' };
    expect(rankHits(files, 'pixel -battery', titleOf).map((h) => h.path)).toEqual(['a.md']);
  });
  it('supports section: filter', () => {
    const files = { 'career/x.md': '# X\npixel', 'projects/y.md': '# Y\npixel' };
    expect(rankHits(files, 'pixel section:career', titleOf).map((h) => h.path)).toEqual(['career/x.md']);
  });
  it('returns [] for an operator-only query with nothing positive', () => {
    expect(rankHits({ 'career/x.md': '# X\npixel' }, 'section:career', titleOf)).toEqual([]);
  });
});

describe('graphData', () => {
  const files = {
    'a.md': '# A\n[b](b.md) [b again](b.md) [ext](https://x) [self](a.md)',
    'b.md': '# B',
    'career/c.md': '# C\n[a](../a.md)',
  };
  it('builds nodes for every file and deduped edges', () => {
    const { nodes, edges } = graphData(files);
    expect(nodes).toHaveLength(3);
    expect(edges).toContainEqual({ source: 'a.md', target: 'b.md' });
    expect(edges).toContainEqual({ source: 'career/c.md', target: 'a.md' });
    // no self-link, no external, deduped b.md
    expect(edges.filter((e) => e.source === 'a.md')).toHaveLength(1);
    expect(nodes.find((n) => n.id === 'career/c.md').section).toBe('career');
  });
});

describe('suggestTargets', () => {
  const files = {
    'career/strategy.md': '# Strategy\npixelpaws traction validation gate pixel',
    'projects/pixelpaws.md': '# PixelPaws\nads for local SMBs',
    'ideas/backlog.md': '# Backlog\nfilters',
  };
  it('ranks the most relevant note first', () => {
    const out = suggestTargets('notes on the traction validation gate for the pixel business', files);
    expect(out[0].path).toBe('career/strategy.md');
  });
  it('caps the number of suggestions', () => {
    expect(suggestTargets('pixelpaws', files, titleOf, 1)).toHaveLength(1);
  });
  it('returns [] when nothing matches', () => {
    expect(suggestTargets('zzzznomatch', files)).toEqual([]);
  });
});

describe('sectionBullets', () => {
  const md = [
    '# Now',
    '## Focus right now',
    '',
    '- **Primary bet:** PixelPaws',
    '- Day job: Acme',
    '',
    '## Next moves',
    'intro line, not a bullet',
    '1. talk to 10 SMBs',
    '- another move',
    '## What is live',
    '- site',
  ].join('\n');

  it('extracts bullets under a heading and stops at the next heading', () => {
    expect(sectionBullets(md, 'Focus right now')).toEqual(['**Primary bet:** PixelPaws', 'Day job: Acme']);
  });
  it('supports ordered + unordered lists and ignores prose', () => {
    expect(sectionBullets(md, 'Next moves')).toEqual(['talk to 10 SMBs', 'another move']);
  });
  it('is case-insensitive and returns [] for a missing heading', () => {
    expect(sectionBullets(md, 'focus right now')).toHaveLength(2);
    expect(sectionBullets(md, 'Nope')).toEqual([]);
    expect(sectionBullets('', 'x')).toEqual([]);
  });
  it('caps the count', () => {
    expect(sectionBullets(md, 'Focus right now', 1)).toEqual(['**Primary bet:** PixelPaws']);
  });
});

describe('escapeHtml', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('<script>a & b</script>')).toBe('&lt;script&gt;a &amp; b&lt;/script&gt;');
  });
  it('escapes quotes so attribute interpolation cannot break out', () => {
    // a note path containing a quote must not be able to inject an attribute
    expect(escapeHtml('x" onerror="alert(1)')).toBe('x&quot; onerror=&quot;alert(1)');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });
  it('renders null/undefined as empty', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('safeUrl', () => {
  it('passes http(s) through', () => {
    expect(safeUrl('https://github.com/x')).toBe('https://github.com/x');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
  });
  it('blocks script-bearing and relative schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>')).toBe('#');
    expect(safeUrl('')).toBe('#');
    expect(safeUrl(undefined)).toBe('#');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-02T12:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString();
  it('bucket by age', () => {
    expect(relativeTime(ago(5e3), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60e3), now)).toBe('5m ago');
    expect(relativeTime(ago(3 * 3600e3), now)).toBe('3h ago');
    expect(relativeTime(ago(2 * 86400e3), now)).toBe('2d ago');
  });
  it('falls back to an ISO date beyond a week', () => {
    expect(relativeTime('2026-01-15T00:00:00Z', now)).toBe('2026-01-15');
  });
  it('is empty for missing or unparseable input', () => {
    expect(relativeTime('', now)).toBe('');
    expect(relativeTime('not-a-date', now)).toBe('');
  });
});
