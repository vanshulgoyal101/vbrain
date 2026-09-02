import { describe, it, expect } from 'vitest';
import { titleOf, resolvePath, rank, excerpt, backlinksFor, fold, tokenize } from '../src/search.js';

// search.js re-exports the canonical engine from public/lib.js. These tests assert
// the WORKER-FACING surface (names + behaviour) the MCP tools rely on.
const FILES = {
  'README.md': '# vbrain\nthe index note',
  'career/profile.md': '# Profile\nAcme analyst. pixel pixel pixel. See [ad](../projects/pixelpaws.md).',
  'projects/pixelpaws.md': '# PixelPaws\nthe focus project for ads and pixel',
};

describe('re-exported surface', () => {
  it('exposes the engine functions', () => {
    expect(typeof rank).toBe('function');
    expect(typeof excerpt).toBe('function');
    expect(typeof fold).toBe('function');
    expect(typeof tokenize).toBe('function');
  });
});

describe('titleOf', () => {
  it('reads the H1', () => expect(titleOf('# Hello\nx', 'a.md')).toBe('Hello'));
  it('falls back to the filename', () => expect(titleOf('no heading', 'career/profile.md')).toBe('profile'));
});

describe('resolvePath', () => {
  it('resolves ../ links', () => expect(resolvePath('career/profile.md', '../projects/pixelpaws.md')).toBe('projects/pixelpaws.md'));
  it('resolves ./ and same-dir links', () => expect(resolvePath('career/profile.md', './strategy.md')).toBe('career/strategy.md'));
  it('returns null for empty', () => expect(resolvePath('a/b.md', '')).toBe(null));
});

describe('rank (BM25-lite)', () => {
  it('finds and ranks matches', () => {
    const hits = rank(FILES, 'pixel');
    const paths = hits.map((h) => h.path);
    expect(paths).toContain('career/profile.md');
    expect(paths).toContain('projects/pixelpaws.md');
  });
  it('boosts a title match', () => {
    expect(rank(FILES, 'pixelpaws')[0].path).toBe('projects/pixelpaws.md');
  });
  it('returns [] for a blank query', () => expect(rank(FILES, '   ')).toEqual([]));
  it('token-matches, not substring', () => {
    expect(rank({ a: '# A\na lion' }, 'on')).toEqual([]);
  });
});

describe('excerpt', () => {
  it('windows around the matched term', () => {
    const ex = excerpt('a'.repeat(100) + ' pixel ' + 'b'.repeat(300), 'pixel');
    expect(ex).toContain('pixel');
    expect(ex.startsWith('…')).toBe(true);
    expect(ex.endsWith('…')).toBe(true);
  });
  it('falls back to the head when no match', () => {
    expect(excerpt('hello world', 'zzz', 5)).toBe('hello');
  });
});

describe('backlinksFor', () => {
  it('finds notes that link to a path', () => {
    expect(backlinksFor('projects/pixelpaws.md', FILES)).toEqual(['career/profile.md']);
  });
  it('returns [] when nothing links in', () => {
    expect(backlinksFor('README.md', FILES)).toEqual([]);
  });
});
