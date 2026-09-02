#!/usr/bin/env node
// Sync the shared, identity-free ENGINE modules from this canonical PUBLIC repo
// to the private brain repo, so a fix lands in both. Dry-run by default.
//
//   node scripts/sync-engine.mjs                     # preview vs ../vbrain-private
//   node scripts/sync-engine.mjs --apply             # write the changes
//   node scripts/sync-engine.mjs --apply ../elsewhere # custom target
//
// Deliberately NOT synced (per-repo config / identity / public-only), edit by hand:
//   • site/wrangler.toml        — real vs placeholder config
//   • site/src/mcp.js           — server description differs per brain
//   • scripts/gen-llms.mjs, scripts/pack.mjs — personalized "second brain" copy
//   • site/src/ssg.js, site/build-site.mjs, site/public-site.css — public-site only
//   • site/test/*, site/docs/*, package.json, notes — per-repo
//
// See docs and the plan: the long-term fix is to parameterize those few identity
// strings so the whole engine is byte-identical (then this list shrinks to zero).

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DEST = resolve(SRC, args.find((a) => !a.startsWith('--')) || '../vbrain-private');

// Identity-free engine code that must stay identical across both brains.
const SHARED_FILES = [
  'site/src/worker.js', 'site/src/http.js', 'site/src/access.js', 'site/src/content.js',
  'site/src/captures.js', 'site/src/edit.js', 'site/src/recent.js', 'site/src/search.js',
  'site/public/lib.js', 'site/public/sw.js', 'site/public/styles.css', 'site/vitest.config.js',
  'scripts/validate.mjs', 'scripts/graph.mjs', 'scripts/doctor.mjs',
  'scripts/new-note.mjs', 'scripts/drain-inbox.mjs',
];
const SHARED_DIRS = ['site/public/vendor'];

function expand(rel) {
  const abs = join(SRC, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs).flatMap((n) => expand(join(rel, n)));
  }
  return [rel];
}

const targets = [...SHARED_FILES, ...SHARED_DIRS.flatMap(expand)];

if (!existsSync(join(DEST, '.git'))) {
  console.error(`✗ target is not a git repo: ${DEST}`);
  process.exit(1);
}

let changed = 0, missing = 0;
for (const rel of targets) {
  const from = join(SRC, rel), to = join(DEST, rel);
  if (!existsSync(from)) { console.error(`  ? source missing: ${rel}`); continue; }
  const src = readFileSync(from);
  const dst = existsSync(to) ? readFileSync(to) : null;
  if (dst !== null && src.equals(dst)) continue;
  changed++;
  if (dst === null) missing++;
  console.log(`  ${dst === null ? 'NEW ' : 'diff'}  ${rel}`);
  if (APPLY) { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, src); }
}

console.log(`\n${APPLY ? 'Synced' : 'Would sync'} ${changed} file(s) (${missing} new) → ${DEST}`);
if (changed && !APPLY) console.log('Run with --apply to write. Then in the target: run tests + commit.');
if (APPLY && changed) console.log('Next: cd the target, `cd site && npm test`, then commit + (if runtime code) deploy.');
