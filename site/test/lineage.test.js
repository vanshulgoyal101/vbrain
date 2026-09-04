import { describe, it, expect } from 'vitest';
import {
  escapeRegex, termPattern, countMentions, isNote, parseLog,
  firstArticulation, summarize, rankFiles, briefList, formatReport,
} from '../../scripts/lineage.mjs';

const REC = '\x01';
const SEP = '\x1f';

describe('termPattern', () => {
  it('treats space, hyphen and underscore as the same separator', () => {
    const re = new RegExp(termPattern('high agency'), 'gi');
    expect('high-agency people').toMatch(re);
    expect('High Agency').toMatch(new RegExp(termPattern('high agency'), 'i'));
    expect('high_agency').toMatch(new RegExp(termPattern('high agency'), 'i'));
  });
  it('emits POSIX bracket expressions for git, which has no \\s', () => {
    expect(termPattern('high agency', { posix: true })).toBe('high[[:space:]_-]+agency');
    expect(termPattern('high agency')).toBe('high[\\s\\-_]+agency');
  });
  it('escapes regex metacharacters in the term', () => {
    expect(escapeRegex('c++ (dsa)')).toBe('c\\+\\+ \\(dsa\\)');
    expect(countMentions('I practice c++ (dsa) daily', 'c++ (dsa)')).toBe(1);
  });
  it('is empty for a blank term', () => {
    expect(termPattern('   ')).toBe('');
    expect(countMentions('anything', '  ')).toBe(0);
  });
});

describe('countMentions', () => {
  it('counts case-insensitively across separator variants', () => {
    expect(countMentions('AdBrain, adbrain and ADBRAIN', 'adbrain')).toBe(3);
    expect(countMentions('high-agency, high agency', 'high agency')).toBe(2);
  });
  it('is zero for absent terms and empty input', () => {
    expect(countMentions('nothing here', 'kochi')).toBe(0);
    expect(countMentions('', 'x')).toBe(0);
    expect(countMentions(null, 'x')).toBe(0);
  });
});

describe('isNote', () => {
  it('accepts brain notes and rejects engine/tooling paths', () => {
    expect(isNote('worldview.md')).toBe(true);
    expect(isNote('career/network.md')).toBe(true);
    expect(isNote('site/README.md')).toBe(false);
    expect(isNote('scripts/README.md')).toBe(false);
    expect(isNote('site/src/worker.js')).toBe(false);
  });
});

describe('parseLog', () => {
  const log = [
    `${REC}abc1234567${SEP}2026-08-15T10:00:00+05:30${SEP}first commit\nworldview.md\nsite/README.md`,
    `${REC}def7654321${SEP}2026-09-03T10:00:00+05:30${SEP}subject with ${SEP} separator\nself.md`,
    `${REC}999${SEP}2026-09-04T10:00:00+05:30${SEP}only engine files\nsite/src/worker.js`,
  ].join('');

  it('extracts short sha, date and note files', () => {
    const out = parseLog(log);
    expect(out).toHaveLength(2); // engine-only commit dropped
    expect(out[0]).toMatchObject({ sha: 'abc1234', date: '2026-08-15', subject: 'first commit' });
    expect(out[0].files).toEqual(['worldview.md']); // site/ filtered out
  });
  it('keeps a subject that itself contains the field separator', () => {
    expect(parseLog(log)[1].subject).toBe(`subject with ${SEP} separator`);
  });
  it('returns nothing for empty input', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog(null)).toEqual([]);
  });
});

describe('firstArticulation', () => {
  const diff = [
    'diff --git a/self.md b/self.md',
    '+++ b/self.md',
    '-  old line about high-agency people',
    ' context line high agency',
    '+- **get closer to high-agency people**',
    '+another high agency line',
  ].join('\n');

  it('returns the first ADDED line mentioning the term, list marker stripped', () => {
    expect(firstArticulation(diff, 'high agency')).toBe('**get closer to high-agency people**');
  });
  it('ignores removed lines, context lines and the +++ header', () => {
    expect(firstArticulation('--- a/x\n+++ b/x\n-gone high agency', 'high agency')).toBe('');
  });
  it('is empty when nothing matches', () => {
    expect(firstArticulation('+unrelated', 'kochi')).toBe('');
    expect(firstArticulation('', 'kochi')).toBe('');
  });
});

describe('summarize', () => {
  const commits = [
    { date: '2026-08-15' }, { date: '2026-09-03' },
  ];
  const current = { 'self.md': 3, 'career/network.md': 1, 'empty.md': 0 };

  it('ranks notes by mentions and drops zero-mention notes', () => {
    const s = summarize(commits, current);
    expect(s.notes).toEqual([
      { path: 'self.md', mentions: 3 },
      { path: 'career/network.md', mentions: 1 },
    ]);
    expect(s.totalMentions).toBe(4);
  });
  it('computes first/last and the span in days', () => {
    const s = summarize(commits, current);
    expect(s.first).toBe('2026-08-15');
    expect(s.last).toBe('2026-09-03');
    expect(s.spanDays).toBe(19);
    expect(s.commits).toBe(2);
  });
  it('handles no history at all', () => {
    const s = summarize([], {});
    expect(s).toMatchObject({ commits: 0, first: '', last: '', spanDays: 0, totalMentions: 0 });
  });
});

describe('rankFiles / briefList', () => {
  it('puts files whose path names the term first', () => {
    expect(rankFiles(['MAP.md', 'projects/adbrain.md', 'now.md'], 'adbrain')[0]).toBe('projects/adbrain.md');
  });
  it('truncates long lists with a remainder count', () => {
    expect(briefList(['a', 'b'], 4)).toBe('a, b');
    expect(briefList(['a', 'b', 'c', 'd', 'e', 'f'], 4)).toBe('a, b, c, d +2 more');
  });
});

describe('formatReport', () => {
  const s = summarize([{ date: '2026-09-03' }], { 'self.md': 3 });
  it('renders the quote, timeline and current homes', () => {
    const out = formatReport('high agency', s, [{ date: '2026-09-03', sha: 'abc1234', subject: 'add self.md', files: ['self.md'] }], 'get closer to high-agency people');
    expect(out).toContain('First introduced  2026-09-03');
    expect(out).toContain('“get closer to high-agency people”');
    expect(out).toContain('abc1234');
    expect(out).toContain('3×  self.md');
    expect(out).toContain('Lives in now (1 note, 3 mentions)');
  });
  it('says so plainly when the term is absent', () => {
    expect(formatReport('nope', summarize([], {}), [], '')).toContain('Not found anywhere in the brain.');
  });
  it('flags an idea that exists in history but in no current note', () => {
    const dropped = summarize([{ date: '2026-01-01' }], {});
    const out = formatReport('dropped', dropped, [{ date: '2026-01-01', sha: 'a', subject: 's', files: ['x.md'] }], '');
    expect(out).toContain('the idea was dropped');
  });
});
