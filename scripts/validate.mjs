#!/usr/bin/env node
// vbrain validator — zero-dependency checks for structure, links, MAP coverage,
// completeness, and accidental secret/PII leakage.
//
// Usage:
//   node scripts/validate.mjs            # report; exits 1 on any ERROR
//   node scripts/validate.mjs --strict   # warnings also fail (exit 1)
//   node scripts/validate.mjs --quiet    # only print failures + summary
//
// Exit code 0 = healthy. Run before/after editing the brain.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLlmsTxt, buildLlmsFullTxt } from './gen-llms.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // vbrain/
const STRICT = process.argv.includes('--strict');
const QUIET = process.argv.includes('--quiet');

// ── thresholds ("a lot of information") ──────────────────────────────────────
const MIN_NONBLANK_LINES = 8;   // below this = thin (warn)
const MIN_WORDS = 50;           // below this = thin (warn)
const TLDR_WINDOW = 6;          // TL;DR blockquote must appear within first N lines

// ── secret / PII patterns (must NEVER be stored) ─────────────────────────────
const SECRET_PATTERNS = [
  [/\bAIza[0-9A-Za-z_\-]{20,}\b/, 'Google API key'],
  [/\bsk-[A-Za-z0-9]{20,}\b/, 'OpenAI-style secret key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\bsbp_[A-Za-z0-9]{20,}\b/, 'Supabase PAT'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/, 'PAN number (PII)'],
  [/\b\d{4}\s\d{4}\s\d{4}\b/, 'Aadhaar-like 12-digit number (PII)'],
];

// ── AI-slop vocabulary (voice lint; warn). Tuned to vbrain — see STYLE.md.
// "leverage"/"robust" excluded intentionally: they carry real domain meaning here.
const SLOP = [
  'delve', 'dive into', 'crucial', 'pivotal', 'paramount', 'comprehensive', 'holistic',
  'seamless', 'seamlessly', 'utilize', 'elevate', 'supercharge', 'unleash',
  'multifaceted', 'nuanced', 'game-changer', 'game changer', 'cutting-edge',
  'state-of-the-art', 'next-gen', 'testament to', 'treasure trove', 'tapestry',
  'meticulous', 'meticulously', 'ever-evolving', 'fast-paced', 'plethora', 'myriad',
  'boasts', 'embark', 'underscore', 'synergy', 'paradigm',
];
const SLOP_RE = new RegExp(`\\b(${SLOP.map((w) => w.replace(/[-\s]/g, '[-\\s]')).join('|')})\\b`, 'i');

const findings = []; // {level:'ERROR'|'WARN', file, msg}
const err = (file, msg) => findings.push({ level: 'ERROR', file, msg });
const warn = (file, msg) => findings.push({ level: 'WARN', file, msg });

// ── collect markdown files ───────────────────────────────────────────────────
const IGNORE_DIRS = new Set(['site', 'node_modules', '.git', 'scripts']);
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (dir === ROOT && IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { if (!IGNORE_DIRS.has(name)) walk(p, acc); }
    else if (name.endsWith('.md')) acc.push(p);
  }
  return acc;
}
const files = walk(ROOT).sort();
const rel = (p) => relative(ROOT, p);

// ── MAP link targets (source of truth for coverage) ──────────────────────────
const mapPath = join(ROOT, 'MAP.md');
const mapText = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : '';
const mapTargets = new Set(
  [...mapText.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1].replace(/\/$/, '')),
);

let totalWords = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const nonBlank = lines.filter((l) => l.trim());
  const words = (text.match(/\S+/g) || []).length;
  totalWords += words;
  const r = rel(file);

  // 1. H1 present as first non-blank line
  if (!nonBlank[0] || !/^#\s+\S/.test(nonBlank[0])) err(r, 'missing H1 title on first line');

  // 2. TL;DR blockquote within the first N lines
  if (!lines.slice(0, TLDR_WINDOW).some((l) => l.startsWith('> '))) err(r, `missing "> TL;DR" within first ${TLDR_WINDOW} lines`);

  // 3. registered in MAP.md
  if (!mapTargets.has(r)) err(r, 'not registered in MAP.md');

  // 4. internal links resolve (.md targets and folder targets)
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    let target = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const isDir = target.endsWith('/');
    target = target.replace(/#.*$/, '');
    if (!target) continue;
    if (!isDir && !target.endsWith('.md')) continue; // skip non-md, non-dir
    const resolved = resolve(dirname(file), target);
    if (!existsSync(resolved)) err(r, `broken link -> ${m[1]}`);
  }

  // 5. duplicate consecutive non-blank lines
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() && lines[i] === lines[i - 1]) { err(r, `duplicate consecutive line: "${lines[i].slice(0, 50)}..."`); break; }
  }

  // 6. secret / PII guard
  for (const [re, label] of SECRET_PATTERNS) {
    const hit = text.match(re);
    if (hit) err(r, `possible ${label}: "${hit[0].slice(0, 24)}…" — remove it`);
  }

  // 6b. literal unicode escapes in prose (JSON-edit artifact; should be real chars)
  let inCode = false;
  lines.forEach((ln, i) => {
    if (/^```/.test(ln.trim())) { inCode = !inCode; return; }
    if (inCode) return;
    const m = ln.match(/\\u[0-9a-fA-F]{4}/);
    if (m) err(r, `literal unicode escape "${m[0]}" on line ${i + 1} (use the real character)`);
  });

  // 6c. AI-slop vocabulary (voice lint; warn). STYLE.md is the denylist itself.
  if (r !== 'STYLE.md') {
    let inFence = false;
    lines.forEach((ln, i) => {
      if (/^```/.test(ln.trim())) { inFence = !inFence; return; }
      if (inFence) return;
      const prose = ln.replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']');
      const hit = prose.match(SLOP_RE);
      if (hit) warn(r, `AI-slop word "${hit[1]}" on line ${i + 1} — see STYLE.md`);
    });
  }

  // 7. completeness (warn)
  if (nonBlank.length < MIN_NONBLANK_LINES || words < MIN_WORDS) warn(r, `thin content (${nonBlank.length} lines / ${words} words; want >= ${MIN_NONBLANK_LINES}/${MIN_WORDS})`);
  if (!lines.some((l) => /^##\s+\S/.test(l))) warn(r, 'no "##" section headings');
}

// 8. dangling MAP rows (targets that point nowhere)
for (const t of mapTargets) {
  if (!t.endsWith('.md')) continue;
  if (!existsSync(resolve(ROOT, t))) err('MAP.md', `dangling MAP entry -> ${t}`);
}

// 9. generated indexes must be in sync with MAP.md (no drift)
for (const [name, build] of [['llms.txt', buildLlmsTxt], ['llms-full.txt', buildLlmsFullTxt]]) {
  const p = join(ROOT, name);
  if (!existsSync(p)) err(name, 'missing — run: node scripts/gen-llms.mjs');
  else if (readFileSync(p, 'utf8') !== build()) err(name, 'stale — run: node scripts/gen-llms.mjs');
}

// ── report ───────────────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.level === 'ERROR');
const warns = findings.filter((f) => f.level === 'WARN');
const show = STRICT ? findings : QUIET ? errors : findings;

for (const f of show) {
  const tag = f.level === 'ERROR' ? '✗ ERROR' : '⚠ WARN ';
  console.log(`${tag}  ${f.file}: ${f.msg}`);
}

console.log('\n── vbrain validation ──');
console.log(`files: ${files.length}   words: ${totalWords}   avg: ${Math.round(totalWords / files.length)}/file`);
console.log(`MAP coverage: ${files.filter((f) => mapTargets.has(rel(f))).length}/${files.length}`);
console.log(`errors: ${errors.length}   warnings: ${warns.length}`);

const failed = errors.length > 0 || (STRICT && warns.length > 0);
console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
