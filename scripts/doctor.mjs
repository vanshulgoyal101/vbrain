#!/usr/bin/env node
// vbrain doctor — a single health report for the brain, inspired by gbrain's
// `doctor`. Combines structure/link validation, graph gaps, and git staleness
// into one status. Non-zero exit if anything is broken.
//
// Usage: node scripts/doctor.mjs

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE = new Set(['site', 'node_modules', '.git', 'scripts', '.github']);
const STALE_DAYS = 120;

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (IGNORE.has(n)) continue;
    const p = join(dir, n), s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (n.endsWith('.md')) acc.push(relative(ROOT, p));
  }
  return acc;
}

const files = walk(ROOT);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

// ── link graph (inline) ──────────────────────────────────────────────────────
const set = new Set(files);
const inbound = new Map(files.map((f) => [f, new Set()]));
const outbound = new Map(files.map((f) => [f, new Set()]));
for (const f of files) {
  for (const m of read(f).matchAll(/\]\(([^)#]+\.md)[^)]*\)/g)) {
    const t = relative(ROOT, resolve(dirname(join(ROOT, f)), m[1]));
    if (set.has(t) && t !== f) { outbound.get(f).add(t); inbound.get(t).add(f); }
  }
}
const orphans = files.filter((f) => f !== 'MAP.md' && [...inbound.get(f)].every((s) => s === 'MAP.md'));

// ── git staleness ────────────────────────────────────────────────────────────
function lastCommit(f) {
  try {
    const ts = execFileSync('git', ['log', '-1', '--format=%ct', '--', f], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        // Sandbox can block ~/.gitconfig reads; force git to ignore global config.
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
    }).toString().trim();
    return ts ? Number(ts) : null;
  } catch { return null; }
}
const now = Date.now() / 1000;
const ages = files.map((f) => ({ f, ct: lastCommit(f) })).filter((x) => x.ct);
const stale = ages.filter((x) => (now - x.ct) / 86400 > STALE_DAYS).sort((a, b) => a.ct - b.ct);
const nowAge = (() => { const c = lastCommit('now.md'); return c ? Math.round((now - c) / 86400) : null; })();

// ── health score + report ─────────────────────────────────────────────────────
const THIN_WORDS = 60;
const asJson = process.argv.includes('--json');
const wordsOf = (f) => (read(f).match(/\S+/g) || []).length;
const words = files.reduce((n, f) => n + wordsOf(f), 0);

// Signals (0..1 each), combined into a weighted 0–100 score you can track weekly.
const mapText = set.has('MAP.md') ? read('MAP.md') : '';
const registered = files.filter((f) => mapText.includes(f));
const underConnected = files.filter((f) => outbound.get(f).size < 2);
const thin = files.filter((f) => wordsOf(f) < THIN_WORDS);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const metrics = {
  coverage:     files.length ? registered.length / files.length : 1,        // registered in MAP.md
  linkage:      files.length ? 1 - orphans.length / files.length : 1,        // few orphans
  connectivity: files.length ? 1 - underConnected.length / files.length : 1, // cross-linked
  freshness:    nowAge == null ? 0.5 : clamp01(1 - Math.max(0, nowAge - 30) / 120), // now.md current
  staleness:    files.length ? 1 - stale.length / files.length : 1,          // few very-old notes
  depth:        files.length ? 1 - thin.length / files.length : 1,           // not stubby
};
const WEIGHTS = { coverage: 25, linkage: 15, connectivity: 20, freshness: 20, staleness: 10, depth: 10 };
const score = Math.round(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * metrics[k], 0));
const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

let problems = 0;
if (nowAge != null && nowAge > 30) problems++;
if (orphans.length) problems++;

// Machine-readable snapshot for trend tracking: `node scripts/doctor.mjs --json >> health.log`
if (asJson) {
  console.log(JSON.stringify({
    at: new Date().toISOString(), score, grade, files: files.length, words,
    metrics, orphans: orphans.length, stale: stale.length,
    underConnected: underConnected.length, thin: thin.length, nowAgeDays: nowAge,
  }));
  process.exit(0);
}

const bar = (v) => '█'.repeat(Math.round(v * 10)).padEnd(10, '·');
console.log('🧠 vbrain doctor\n');
console.log(`Health score: ${score}/100  (${grade})\n`);
for (const [k, w] of Object.entries(WEIGHTS)) console.log(`  ${bar(metrics[k])}  ${k.padEnd(12)} ${Math.round(metrics[k] * 100)}%  (weight ${w})`);
console.log(`\nFiles:        ${files.length}`);
console.log(`Words:        ${words} (~${Math.round(words / files.length)}/file)`);
console.log(`Links:        ${[...outbound.values()].reduce((n, s) => n + s.size, 0)} internal edges`);
console.log(`now.md age:   ${nowAge == null ? 'unknown' : nowAge + ' days'}${nowAge > 30 ? '  ⚠ refresh it' : ''}`);

console.log(`\nOrphans (only reachable via MAP): ${orphans.length}`);
orphans.forEach((f) => console.log(`  · ${f}`));

if (underConnected.length) {
  console.log(`\nUnder-connected (< 2 outbound links): ${underConnected.length}`);
  underConnected.slice(0, 10).forEach((f) => console.log(`  · ${f}`));
}
if (thin.length) {
  console.log(`\nThin (< ${THIN_WORDS} words): ${thin.length}`);
  thin.slice(0, 10).forEach((f) => console.log(`  · ${wordsOf(f)}w  ${f}`));
}

console.log(`\nStale (> ${STALE_DAYS} days since last commit): ${stale.length}`);
stale.slice(0, 10).forEach((x) => console.log(`  · ${Math.round((now - x.ct) / 86400)}d  ${x.f}`));

// Oldest-touched notes are the best "re-verify these facts" candidates.
const verify = [...ages].sort((a, b) => a.ct - b.ct).slice(0, 5);
if (verify.length) {
  console.log('\nVerify-me (oldest-touched — re-check the facts):');
  verify.forEach((x) => console.log(`  · ${Math.round((now - x.ct) / 86400)}d  ${x.f}`));
}

console.log('\nRun `node scripts/validate.mjs` for structure/link/secret checks,');
console.log('and `node scripts/graph.mjs` for the full connectivity report.');
console.log(`\nStatus: ${problems ? '⚠ needs attention' : '✅ healthy'}`);
process.exit(problems ? 1 : 0);
