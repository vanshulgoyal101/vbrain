// Pure, framework-free helpers for the brain UI. No DOM here → unit-testable.

export function sectionOf(path) {
  return path.includes('/') ? path.split('/')[0] : '';
}

export function titleOf(md, path) {
  const h1 = (md || '').match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : path.split('/').pop().replace(/\.md$/, '');
}

// Resolve a relative link from a file to a repo-relative path (handles ./ and ../).
export function resolvePath(from, rel) {
  if (!rel) return null;
  const base = from.split('/').slice(0, -1);
  for (const part of rel.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

// Comparator factory: FIRST = filenames pinned to the top in order.
export function sortPaths(FIRST = []) {
  return (a, b) => {
    const fa = FIRST.indexOf(a.split('/').pop());
    const fb = FIRST.indexOf(b.split('/').pop());
    const ra = fa === -1 ? 99 : fa;
    const rb = fb === -1 ? 99 : fb;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  };
}

// ── search core: diacritic-folded, token-based, BM25-lite ───────────────────

// Length-preserving lowercase + Latin diacritic fold, so "résumé" matches
// "resume" while keeping indices aligned with the source (needed for snippets).
const FOLD_MAP = { 'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y', 'æ': 'a', 'œ': 'o' };
export function fold(s) {
  return String(s).toLowerCase().replace(/[àáâãäåçèéêëìíîïñòóôõöùúûüýÿæœ]/g, (c) => FOLD_MAP[c] || c);
}

// Split text into lowercased, diacritic-folded word tokens.
export function tokenize(s) {
  return fold(s).match(/[\p{L}\p{N}]+/gu) || [];
}

function escapeSearch(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// A document token matches a query term on exact equality or a prefix (len ≥ 4),
// giving light, safe stemming (deploy↔deployment) without matching "on" in "lion".
function tokenMatches(tok, term) {
  return tok === term || (term.length >= 4 && tok.startsWith(term)) || (tok.length >= 4 && term.startsWith(tok));
}

// Same, but also accepts a close typo (edit distance ≤ 1, or ≤ 2 for long terms) so
// snippets anchor/highlight the actual matched word behind a fuzzy query.
function tokenFuzzyMatch(tok, term) {
  if (tokenMatches(tok, term)) return true;
  if (term.length < 4) return false;
  const max = term.length >= 8 ? 2 : 1;
  return editDistanceLE(tok, term, max) <= max;
}

export function matches(path, q, md, titleFn = titleOf) {
  if (!q) return true;
  const f = fold(q);
  return fold(path).includes(f) || fold(titleFn(md, path)).includes(f) || fold(md || '').includes(f);
}

// A context window around the earliest query-term match (folded, length-preserving
// so indices align). Returns a plain string with … ellipses.
export function excerpt(text, q, len = 240) {
  if (!text) return '';
  const terms = positiveTokens(q);
  if (!terms.length) return text.slice(0, len).trim();
  const f = fold(text);
  let i = -1;
  // Anchor on the earliest word token that matches any term (exact/prefix/fuzzy).
  for (const m of f.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (terms.some((t) => tokenFuzzyMatch(m[0], t))) { i = m.index; break; }
  }
  // Fall back to a substring hit (covers multi-word phrases).
  if (i === -1) { for (const t of terms) { const j = f.indexOf(t); if (j !== -1 && (i === -1 || j < i)) i = j; } }
  if (i === -1) return text.slice(0, len).trim();
  const start = Math.max(0, i - Math.floor(len / 3));
  const end = Math.min(text.length, start + len);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

// HTML-escape `text` and wrap every query-term occurrence (incl. close typos) in <mark>.
export function highlight(text, q) {
  const terms = positiveTokens(q);
  if (!terms.length) return escapeSearch(text);
  return String(text).split(/([\p{L}\p{N}]+)/u).map((part) => {
    if (!part) return '';
    if (/^[\p{L}\p{N}]+$/u.test(part) && terms.some((t) => tokenFuzzyMatch(fold(part), t))) return `<mark>${escapeSearch(part)}</mark>`;
    return escapeSearch(part);
  }).join('');
}

export function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

// Which files link to `path` (backlinks), given all files and a resolver.
export function backlinksFor(path, files, resolve = resolvePath) {
  const out = [];
  for (const [p, md] of Object.entries(files)) {
    if (p === path) continue;
    for (const m of (md || '').matchAll(/\]\(([^)#]+\.md)[^)]*\)/g)) {
      if (resolve(p, m[1]) === path) { out.push(p); break; }
    }
  }
  return out.sort();
}

// Build a small in-memory index once per files object (memoized via WeakMap).
const INDEX_CACHE = new WeakMap();
function buildIndex(files, titleFn) {
  const docs = [];
  const vocab = new Set();
  let totalLen = 0;
  for (const [path, md] of Object.entries(files)) {
    const bodyTokens = tokenize(md || '');
    const tf = new Map();
    for (const t of bodyTokens) { tf.set(t, (tf.get(t) || 0) + 1); vocab.add(t); }
    const len = bodyTokens.length || 1;
    totalLen += len;
    const headingText = (md || '').split('\n').filter((l) => /^#{1,6}\s/.test(l)).join(' ');
    const title = new Set(tokenize(titleFn(md, path)));
    const pathTok = new Set(tokenize(path.replace(/\.md$/, '')));
    const heading = new Set(tokenize(headingText));
    for (const s of [title, pathTok, heading]) for (const t of s) vocab.add(t);
    // `blob` is the folded full text (path + body) for phrase / -phrase substring checks.
    docs.push({ path, tf, len, title, pathTok, heading, blob: fold(`${path.replace(/\.md$/, '')}\n${md || ''}`) });
  }
  return { docs, N: docs.length || 1, avgdl: (totalLen / (docs.length || 1)) || 1, vocab };
}
function getIndex(files, titleFn) {
  let ix = INDEX_CACHE.get(files);
  if (!ix) { ix = buildIndex(files, titleFn); INDEX_CACHE.set(files, ix); }
  return ix;
}

// Term frequency in a doc, counting exact tokens + prefix matches (len ≥ 4).
function docTermFreq(doc, term) {
  let n = doc.tf.get(term) || 0;
  if (term.length >= 4) { for (const [k, v] of doc.tf) { if (k !== term && k.startsWith(term)) n += v; } }
  return n;
}
function setHas(set, term) {
  if (set.has(term)) return true;
  if (term.length >= 4) { for (const k of set) { if (k.startsWith(term)) return true; } }
  return false;
}
function docHasToken(doc, term) {
  return docTermFreq(doc, term) > 0 || setHas(doc.title, term) || setHas(doc.heading, term) || setHas(doc.pathTok, term);
}

// Bounded Levenshtein: the true distance, or max+1 once it provably exceeds `max`.
export function editDistanceLE(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i; let rowMin = dp[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
      if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > max) return max + 1;
  }
  return dp[b.length];
}

function termInVocab(term, vocab) {
  if (vocab.has(term)) return true;
  if (term.length >= 4) { for (const v of vocab) { if (v.startsWith(term)) return true; } }
  return false;
}

// Turn a query term into a matcher: exact/prefix, or a fuzzy variant-set (typo
// tolerance, edit-distance ≤ 1, or ≤ 2 for long terms) when it has no exact/prefix
// hit anywhere in the corpus. `dead` = matches nothing at all.
function buildMatcher(term, vocab) {
  if (termInVocab(term, vocab)) return { term, fuzzy: false };
  if (term.length >= 4) {
    const max = term.length >= 8 ? 2 : 1;
    const variants = new Set();
    for (const v of vocab) { if (editDistanceLE(term, v, max) <= max) variants.add(v); }
    if (variants.size) return { term, fuzzy: true, variants };
  }
  return { term, fuzzy: false, dead: true };
}
function matcherTF(doc, m) {
  if (m.fuzzy) { let n = 0; for (const v of m.variants) n += doc.tf.get(v) || 0; return n; }
  return docTermFreq(doc, m.term);
}
function matcherField(set, m) {
  if (m.fuzzy) { for (const v of m.variants) if (set.has(v)) return true; return false; }
  return setHas(set, m.term);
}

// Parse a query into phrases, plain terms, exclusions and an optional section.
// Operators:  "exact phrase"   -exclude   -"exclude phrase"   section:career
export function parseQuery(q) {
  const phrases = [], excludePhrases = [];
  const rest = String(q).replace(/(-?)"([^"]+)"/g, (_, neg, ph) => {
    const f = fold(ph.trim()); if (f) (neg ? excludePhrases : phrases).push(f); return ' ';
  });
  let section = null;
  const terms = [], excludes = [];
  for (const tok of rest.split(/\s+/)) {
    if (!tok) continue;
    const sec = tok.match(/^section:(.+)$/i);
    if (sec) { section = fold(sec[1]).replace(/\/+$/, ''); continue; }
    if (tok[0] === '-' && tok.length > 1) { excludes.push(...tokenize(tok.slice(1))); continue; }
    terms.push(...tokenize(tok));
  }
  return { phrases, excludePhrases, terms: [...new Set(terms)], excludes: [...new Set(excludes)], section };
}

// The positive tokens to anchor/highlight for a query (terms + phrase words —
// never the excluded terms or the section: keyword).
function positiveTokens(q) {
  const { phrases, terms } = parseQuery(q);
  const set = new Set(terms);
  for (const p of phrases) for (const t of tokenize(p)) set.add(t);
  return [...set];
}

const BM25_K1 = 1.4, BM25_B = 0.7, FUZZY_WEIGHT = 0.55, PHRASE_SCORE = 5;

// Ranked search — BM25-lite: IDF + length normalization, title/heading/path field
// boosts, a multi-term coverage bonus, typo tolerance, and "phrase" / -exclude /
// section: operators. Returns [{ path, score }] best-first.
export function rankHits(files, q, titleFn = titleOf) {
  const { phrases, excludePhrases, terms, excludes, section } = parseQuery(q);
  if (!phrases.length && !terms.length) return [];
  const { docs, N, avgdl, vocab } = getIndex(files, titleFn);

  const matchers = terms.map((t) => buildMatcher(t, vocab)).filter((m) => !m.dead);
  const idf = matchers.map((m) => {
    let df = 0;
    for (const d of docs) { if (matcherTF(d, m) || matcherField(d.title, m) || matcherField(d.pathTok, m) || matcherField(d.heading, m)) df++; }
    df = df || 0.5;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  });

  const scored = [];
  for (const d of docs) {
    if (section && sectionOf(d.path) !== section) continue;
    if (excludePhrases.some((p) => d.blob.includes(p))) continue;
    if (excludes.some((t) => docHasToken(d, t))) continue;
    if (phrases.length && !phrases.every((p) => d.blob.includes(p))) continue;

    let score = 0, matched = 0;
    matchers.forEach((m, i) => {
      const tf = matcherTF(d, m);
      const inTitle = matcherField(d.title, m), inHead = matcherField(d.heading, m), inPath = matcherField(d.pathTok, m);
      if (!tf && !inTitle && !inHead && !inPath) return;
      matched++;
      const norm = tf ? (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (d.len / avgdl))) : 0;
      const w = m.fuzzy ? FUZZY_WEIGHT : 1;
      score += idf[i] * w * (norm + (inTitle ? 3.5 : 0) + (inHead ? 1.5 : 0) + (inPath ? 1 : 0));
    });
    if (phrases.length) { score += PHRASE_SCORE * phrases.length; matched += phrases.length; }
    if (!matched) continue;
    score *= 1 + 0.4 * (matched - 1); // coverage bonus — reward matching more of the query
    scored.push({ path: d.path, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

// Suggest the best note(s) to file a capture into, by ranking note bodies against
// the capture text. Returns up to `n` { path, score }.
export function suggestTargets(text, files, titleFn = titleOf, n = 3) {
  return rankHits(files, text, titleFn).slice(0, n);
}

// Bullet lines under a "## <heading>" section of a note (stops at the next heading).
export function sectionBullets(md, heading, n = 6) {
  if (!md) return [];
  const lines = md.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^#{2,}\\s+${heading}`, 'i').test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length && out.length < n; i++) {
    if (/^#{2,}\s/.test(lines[i])) break; // reached the next section
    if (/^\s*([-*]|\d+\.)\s+/.test(lines[i])) out.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '').trim());
  }
  return out;
}

// Nodes + edges for the visual graph (deduped, no self-links).
export function graphData(files, resolve = resolvePath) {
  const paths = Object.keys(files);
  const set = new Set(paths);
  const nodes = paths.map((p) => ({ id: p, section: sectionOf(p), title: titleOf(files[p], p) }));
  const edges = [];
  for (const p of paths) {
    const seen = new Set();
    for (const m of (files[p] || '').matchAll(/\]\(([^)#]+\.md)[^)]*\)/g)) {
      const t = resolve(p, m[1]);
      if (set.has(t) && t !== p && !seen.has(t)) { seen.add(t); edges.push({ source: p, target: t }); }
    }
  }
  return { nodes, edges };
}


