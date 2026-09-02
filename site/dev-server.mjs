// Local dev server — view the brain (incl. the knowledge graph) with zero cloud
// dependencies. Serves ./public and feeds the UI the brain's markdown straight
// from the local repo, standing in for the Cloudflare Worker's /api endpoints.
//
//   node dev-server.mjs   ->  http://localhost:8787
//
// This bypasses Supabase auth + GITHUB_TOKEN on purpose (read-only, local): it
// returns an empty /auth/config so the SPA runs in dev mode with no login.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const PORT = Number(process.env.PORT || 8787);
const ROOT = resolve(import.meta.dirname, '..'); // vbrain/
const PUBLIC = resolve(import.meta.dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
};

// Recursively collect brain .md files (mirrors src/content.js selectBrainFiles).
async function collectBrain() {
  const files = {};
  async function walk(dir) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      const rel = relative(ROOT, abs);
      if (ent.isDirectory()) {
        if (['site', 'node_modules', '.git'].includes(ent.name)) continue;
        await walk(abs);
      } else if (extname(ent.name) === '.md') {
        files[rel] = await readFile(abs, 'utf8');
      }
    }
  }
  await walk(ROOT);
  return files;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/healthz') {
      return send(res, 200, JSON.stringify({ ok: true, service: 'vbrain-dev' }), { 'content-type': MIME['.json'] });
    }
    if (path === '/auth/config') {
      // Local dev serves content without login (no supabaseUrl → frontend dev mode).
      return send(res, 200, JSON.stringify({ supabaseUrl: null, anonKey: null }), { 'content-type': MIME['.json'] });
    }
    if (path === '/api/me') {
      return send(res, 200, JSON.stringify({ email: 'owner@example.com (local dev)', capture: false, edit: false, recent: true }), { 'content-type': MIME['.json'] });
    }
    if (path === '/api/recent') {
      try {
        const { stdout } = await run('git', ['-C', ROOT, 'log', '-n', '20', '--pretty=format:%h%x1f%s%x1f%aI%x1f%an'], { maxBuffer: 1 << 20 });
        const commits = stdout.split('\n').filter(Boolean).map((line) => {
          const [sha, message, date, author] = line.split('\x1f');
          return { sha, message, date, author, url: null };
        });
        return send(res, 200, JSON.stringify({ commits, generatedAt: Date.now() }), { 'content-type': MIME['.json'] });
      } catch {
        return send(res, 200, JSON.stringify({ commits: [] }), { 'content-type': MIME['.json'] });
      }
    }
    if (path === '/api/bundle') {
      const f = await collectBrain();
      return send(res, 200, JSON.stringify({ files: f, count: Object.keys(f).length, generatedAt: Date.now() }), { 'content-type': MIME['.json'] });
    }
    if (path === '/api/captures') {
      return send(res, 200, JSON.stringify({ captures: [] }), { 'content-type': MIME['.json'] });
    }
    if (path.startsWith('/api/')) {
      return send(res, 200, JSON.stringify({ ok: false, dev: true, note: 'disabled in local dev' }), { 'content-type': MIME['.json'] });
    }

    // static files
    let file = path === '/' ? '/index.html' : path;
    const abs = resolve(PUBLIC, '.' + file);
    if (!abs.startsWith(PUBLIC)) return send(res, 403, 'forbidden'); // path traversal guard
    try {
      const s = await stat(abs);
      if (s.isDirectory()) return send(res, 404, 'not found');
      const body = await readFile(abs);
      return send(res, 200, body, { 'content-type': MIME[extname(abs)] || 'application/octet-stream' });
    } catch {
      return send(res, 404, 'not found');
    }
  } catch (e) {
    send(res, 500, String(e && e.message || e));
  }
});

server.listen(PORT, () => {
  console.log(`\n  vbrain (local)  ->  http://localhost:${PORT}\n  graph view      ->  http://localhost:${PORT}/#/graph\n`);
});
