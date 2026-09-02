#!/usr/bin/env node
// vbrain note scaffolder — creates a new note with the correct header shape so it
// passes the validator, then reminds you to register it in MAP.md.
//
// Usage:
//   node scripts/new-note.mjs <relative/path.md> "Title" "One-line TL;DR"
// Example:
//   node scripts/new-note.mjs projects/foo.md "Foo" "What Foo is, in one line."

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [target, title, tldr] = process.argv.slice(2);

if (!target || !title || !tldr) {
  console.error('Usage: node scripts/new-note.mjs <relative/path.md> "Title" "One-line TL;DR"');
  process.exit(1);
}
if (!target.endsWith('.md')) { console.error('Path must end in .md'); process.exit(1); }

const abs = resolve(ROOT, target);
if (existsSync(abs)) { console.error(`Refusing to overwrite existing file: ${target}`); process.exit(1); }

const body = `# ${title}

> **TL;DR** — ${tldr}

## Overview

_Write the content here. Lead with the most useful / most recent facts. Bullets
over prose. Keep it accurate and honest; never store secrets or PII._

_Last updated: ${new Date().toISOString().slice(0, 10)}._
`;

mkdirSync(dirname(abs), { recursive: true });
writeFileSync(abs, body);

const key = relative(ROOT, abs).replace(/\.md$/, '').replace(/\//g, '.');
console.log(`Created ${relative(ROOT, abs)}`);
console.log('\nNext steps (required):');
console.log(`  1. Register it in MAP.md, e.g.:`);
console.log(`     | \`${key}\` | [${relative(ROOT, abs)}](${relative(ROOT, abs)}) | ${tldr} |`);
console.log('  2. Fill in the content.');
console.log('  3. Run: node scripts/validate.mjs');
