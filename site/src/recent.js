// Recent-changes feed — the last commits to the private repo, via the GitHub
// commits API (read token). One cheap call, edge-cached ~2 min. Powers the
// "Recently changed" and "Briefing" views.

import { json } from './http.js';

const RECENT_CACHE_KEY = 'https://brain.internal/recent-v1';

export function recentEnabled(env) {
  return Boolean(env.GITHUB_TOKEN);
}

// Pure: shape the GitHub commits payload into a small, safe feed.
export function shapeCommits(arr, limit = 20) {
  return (Array.isArray(arr) ? arr : []).slice(0, limit).map((c) => ({
    sha: String(c.sha || '').slice(0, 7),
    message: String(c.commit?.message || '').split('\n')[0].slice(0, 200),
    date: c.commit?.author?.date || c.commit?.committer?.date || null,
    author: c.commit?.author?.name || null,
    url: c.html_url || null,
  }));
}

export async function fetchRecent(env, fetchImpl = fetch, limit = 20) {
  const { GH_OWNER, GH_REPO, GH_BRANCH = 'main', GITHUB_TOKEN } = env;
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret not set');
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/commits?sha=${GH_BRANCH}&per_page=${limit}`;
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'vbrain', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`github ${res.status}`);
  return shapeCommits(await res.json(), limit);
}

export async function recentResponse(env, ctx, fetchImpl = fetch) {
  if (!recentEnabled(env)) return json({ error: 'recent not configured' }, 503);
  const cache = caches.default;
  const cacheKey = new Request(RECENT_CACHE_KEY);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let commits;
  try {
    commits = await fetchRecent(env, fetchImpl);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
  const out = json({ commits, generatedAt: Date.now() }, 200, { 'cache-control': 'private, max-age=120' });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}
