#!/usr/bin/env node
// vbrain lineage — how did my thinking about X evolve?
//
// Borrowed from gbrain's idea-lineage skill, but deterministic: the whole answer
// comes from git history, so there is no model, API key, or cost involved.
// Uses git's pickaxe (-S), which matches commits where the NUMBER of occurrences
// of the term changed — i.e. where the idea was actually introduced or reworked,
// not merely where the file was touched.
//
//   node scripts/lineage.mjs "high agency"
//   node scripts/lineage.mjs adbrain --json
//
// Exits 1 when the term appears nowhere, so it composes in scripts.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Same exclusions the rest of the brain scripts use: only notes count.
const IGNORE = new Set(['site', 'node_modules', '.git', 'scripts', '.github']);
const REC = '\x01';
const SEP = '\x1f';

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Notes write the same idea as "high agency", "high-agency" or "high_agency", so a
// literal search misses most of its own history. Treat any run of space/hyphen/
// underscore as interchangeable. Returns regex SOURCE, shared by the counter and
// git's pickaxe so both agree on what a mention is. git uses POSIX regex, which
// has no `\s`, so it needs the bracket-expression form.
export function termPattern(term, { posix = false } = {}) {
  const sep = posix ? '[[:space:]_-]+' : '[\\s\\-_]+';
  return String(term).trim().split(/[\s\-_]+/).filter(Boolean).map(escapeRegex).join(sep);
}

// Count case-insensitive occurrences of the term.
export function countMentions(text, term) {
  const src = termPattern(term);
  if (!src) return 0;
  return (String(text || '').match(new RegExp(src, 'gi')) || []).length;
}

export function isNote(path) {
  return path.endsWith('.md') && !IGNORE.has(path.split('/')[0]);
}

// Parse `git log --format=<REC>%H<SEP>%aI<SEP>%s --name-only` into records.
// Oldest-first is imposed by the caller; this just preserves git's order.
export function parseLog(stdout) {
  return String(stdout || '')
    .split(REC)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [header, ...rest] = block.split('\n');
      const [sha, date, ...subjectParts] = header.split(SEP);
      return {
        sha: (sha || '').slice(0, 7),
        date: (date || '').slice(0, 10),
        subject: subjectParts.join(SEP),
        files: rest.map((l) => l.trim()).filter((l) => isNote(l)),
      };
    })
    .filter((c) => c.files.length);
}

// The first line a commit ADDED that mentions the term — the earliest wording.
export function firstArticulation(diff, term) {
  for (const line of String(diff || '').split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const body = line.slice(1).trim();
    if (body && countMentions(body, term)) return body.replace(/^[-*]\s*/, '');
  }
  return '';
}

// Fold the commit list + working-tree counts into the shape the report needs.
export function summarize(commits, current) {
  const notes = Object.entries(current)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path, mentions]) => ({ path, mentions }));
  const dates = commits.map((c) => c.date).filter(Boolean).sort();
  const spanDays = dates.length
    ? Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000)
    : 0;
  return {
    commits: commits.length,
    first: dates[0] || '',
    last: dates[dates.length - 1] || '',
    spanDays,
    notes,
    totalMentions: notes.reduce((s, n) => s + n.mentions, 0),
  };
}

// Files whose path names the term are the ones most likely to be about it, so
// quote those first rather than an incidental mention elsewhere in the commit.
export function rankFiles(files, term) {
  const t = String(term).toLowerCase();
  return [...files].sort((a, b) => (b.toLowerCase().includes(t) ? 1 : 0) - (a.toLowerCase().includes(t) ? 1 : 0));
}

export function briefList(items, max = 4) {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} +${items.length - max} more`;
}

export function formatReport(term, s, timeline, opening) {
  const out = [`\n🧬 Lineage — "${term}"\n`];
  if (!s.notes.length && !timeline.length) {
    out.push('Not found anywhere in the brain.\n');
    return out.join('\n');
  }
  if (s.first) {
    out.push(`First introduced  ${s.first}${s.spanDays ? `   ·   ${s.spanDays} day${s.spanDays === 1 ? '' : 's'} of history` : ''}`);
    if (opening) out.push(`   “${opening.slice(0, 160)}${opening.length > 160 ? '…' : ''}”`);
    out.push('');
  }
  if (timeline.length) {
    out.push('Timeline (commits that changed how often it appears)');
    for (const c of timeline) {
      out.push(`  ${c.date}  ${c.sha}  ${briefList(rankFiles(c.files, term))}`);
      out.push(`              ${c.subject.slice(0, 72)}`);
    }
    out.push('');
  }
  if (s.notes.length) {
    out.push(`Lives in now (${s.notes.length} note${s.notes.length === 1 ? '' : 's'}, ${s.totalMentions} mention${s.totalMentions === 1 ? '' : 's'})`);
    for (const n of s.notes.slice(0, 12)) out.push(`  · ${n.mentions.toString().padStart(3)}×  ${n.path}`);
    if (s.notes.length > 12) out.push(`  · … and ${s.notes.length - 12} more`);
  } else {
    out.push('⚠️  Present in history but in no current note — the idea was dropped.');
  }
  out.push('');
  return out.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (IGNORE.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (n.endsWith('.md')) acc.push(relative(ROOT, p));
  }
  return acc;
}

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json');
  const term = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!term) {
    console.error('Usage: node scripts/lineage.mjs "<term>" [--json]');
    process.exit(2);
  }

  let commits = [];
  try {
    commits = parseLog(git([
      'log', '--reverse', `--format=${REC}%H${SEP}%aI${SEP}%s`, '--name-only',
      '-i', '--pickaxe-regex', `-S${termPattern(term, { posix: true })}`, '--', '*.md',
    ])); // oldest first
  } catch {
    // no git history (shallow clone / export) — fall back to the working tree
  }

  const current = {};
  for (const f of walk(ROOT)) {
    const n = countMentions(readFileSync(join(ROOT, f), 'utf8'), term);
    if (n) current[f] = n;
  }

  const s = summarize(commits, current);
  let opening = '';
  if (commits.length) {
    const first = commits[0];
    // `git show` emits files in its own order, so ask one file at a time and
    // stop at the first hit — that keeps the most on-topic file's wording.
    for (const f of rankFiles(first.files, term)) {
      try { opening = firstArticulation(git(['show', first.sha, '--', f]), term); } catch { /* ignore */ }
      if (opening) break;
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify({ term, ...s, opening, timeline: commits }, null, 2));
  } else {
    console.log(formatReport(term, s, commits, opening));
  }
  process.exit(s.notes.length || commits.length ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
