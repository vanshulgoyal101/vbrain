// Content: fetch the private repo as one tarball and extract the brain markdown.

import { json } from './http.js';

export const BUNDLE_CACHE_KEY = 'https://brain.internal/bundle-v2';

// Drop the cached bundle so the next /api/bundle reflects a fresh commit.
export async function purgeBundle() {
  try { await caches.default.delete(new Request(BUNDLE_CACHE_KEY)); } catch {}
}

// Pure ustar tar parser → { fullPath: Uint8Array }. Skips non-file entries.
export function parseTar(buf) {
  const files = {};
  const td = new TextDecoder();
  let off = 0;
  while (off + 512 <= buf.length) {
    const block = buf.subarray(off, off + 512);
    const name = td.decode(block.subarray(0, 100)).replace(/\0.*$/, '');
    if (!name) break; // end-of-archive padding
    const sizeStr = td.decode(block.subarray(124, 136)).replace(/[^0-7]/g, '');
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    const prefix = td.decode(block.subarray(345, 500)).replace(/\0.*$/, '');
    const typeflag = block[156];
    const full = prefix ? `${prefix}/${name}` : name;
    off += 512;
    // typeflag '0' (0x30) or NUL = regular file
    if (typeflag === 0x30 || typeflag === 0) files[full] = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

// Pure: strip the leading "owner-repo-sha/" segment, keep brain .md files only.
export function selectBrainFiles(rawFiles) {
  const out = {};
  const dec = new TextDecoder();
  for (const [name, bytes] of Object.entries(rawFiles)) {
    const path = name.split('/').slice(1).join('/');
    if (!path.endsWith('.md')) continue;
    if (path.startsWith('site/') || path.includes('node_modules/')) continue;
    out[path] = dec.decode(bytes);
  }
  return out;
}

export async function fetchBundle(env, fetchImpl = fetch) {
  const { GH_OWNER, GH_REPO, GH_BRANCH = 'main', GITHUB_TOKEN } = env;
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret not set');
  const tarUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/tarball/${GH_BRANCH}`;
  const res = await fetchImpl(tarUrl, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'vbrain', Accept: 'application/vnd.github+json' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  const gunzip = res.body.pipeThrough(new DecompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(gunzip).arrayBuffer());
  return selectBrainFiles(parseTar(buf));
}

export async function bundleResponse(env, ctx, fetchImpl = fetch) {
  const cache = caches.default;
  const cacheKey = new Request(BUNDLE_CACHE_KEY);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let files;
  try {
    files = await fetchBundle(env, fetchImpl);
  } catch (e) {
    const msg = String(e && e.message || e);
    return json({ error: msg }, msg.includes('secret not set') ? 503 : 502);
  }

  const out = json({ files, count: Object.keys(files).length, generatedAt: Date.now() }, 200, { 'cache-control': 'private, max-age=300' });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
