// Brain UI controller. Loads the whole brain in one authenticated request, then
// renders markdown, navigation, search, backlinks, ToC, and the capture inbox.
import { sectionOf, titleOf, resolvePath, sortPaths, matches, excerpt, highlight, slugify, backlinksFor, rankHits, graphData, suggestTargets, sectionBullets, escapeHtml, safeUrl, relativeTime } from './lib.js';

const SECTION_LABEL = {
  '': 'Overview', career: 'Career', projects: 'Projects',
  ideas: 'Ideas', learnings: 'Learnings', infra: 'Infra', scripts: 'Scripts',
};
const SECTION_ORDER = ['', 'career', 'projects', 'ideas', 'learnings', 'infra', 'scripts'];
const FIRST = ['README.md', 'MAP.md', 'now.md', 'about-me.md', 'worldview.md'];
const cmp = sortPaths(FIRST);

const $ = (s) => document.querySelector(s);
let FILES = {};
let current = null;

// Register the offline app-shell service worker (shell only — never brain content).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
let captureEnabled = false;
let editEnabled = false;
let recentEnabled = false;
let INBOX = [];
let navItems = [];   // current visible nav paths (for keyboard nav)

const viewIcon = (id) => {
  const paths = {
    briefing: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/><circle cx="12" cy="12" r="7.5"/>',
    graph: '<circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="17" r="2.2"/><circle cx="19" cy="17" r="2.2"/><path d="m10.6 6.8-4.2 8.4M13.4 6.8l4.2 8.4M7.2 17h9.6"/>',
    recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
  };
  const svg = document.createElement('span');
  svg.className = 'view-icon';
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[id] || paths.briefing}</svg>`;
  return svg;
};

// ── Supabase Google auth ────────────────────────────────────────────────────
const SESSION_KEY = 'vbrain.session';
let AUTH = { supabaseUrl: null, anonKey: null };
let SESSION = null; // { access_token, refresh_token, expires_at }

const loadSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
function saveSession(s) { SESSION = s; if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); }

// Supabase returns tokens in the URL hash after Google login; capture + clean it.
function captureOAuthHash() {
  if (!location.hash.includes('access_token=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const at = p.get('access_token');
  if (at) saveSession({ access_token: at, refresh_token: p.get('refresh_token'), expires_at: Number(p.get('expires_at')) || 0 });
  history.replaceState(null, '', location.pathname + location.search);
}

async function refreshSession() {
  if (!SESSION?.refresh_token || !AUTH.supabaseUrl) return false;
  try {
    const r = await fetch(`${AUTH.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: AUTH.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: SESSION.refresh_token }),
    });
    if (!r.ok) return false;
    const d = await r.json();
    saveSession({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) });
    return true;
  } catch { return false; }
}

function signIn() {
  const redirect = encodeURIComponent(location.origin + '/');
  location.href = `${AUTH.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${redirect}`;
}
function signOut() { saveSession(null); location.reload(); }

// Authed fetch: attaches the Bearer token; on 401 refreshes once and retries.
async function api(path, opts = {}) {
  const call = (tok) => fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
  let res = await call(SESSION?.access_token);
  if (res.status === 401 && await refreshSession()) res = await call(SESSION?.access_token);
  return res;
}

function renderLogin() {
  $('#who').textContent = 'not signed in';
  const el = $('#content');
  el.innerHTML = `<div class="login"><h1>Private second brain</h1><p class="muted">Sign in to continue \u2014 access is limited to the owner.</p><button id="signInBtn" class="signin" type="button">Sign in with Google</button></div>`;
  $('#signInBtn')?.addEventListener('click', signIn);
}

init();

async function init() {
  captureOAuthHash();
  SESSION = loadSession();
  try { AUTH = await fetch('/auth/config').then((r) => r.json()); } catch {}
  const devMode = !AUTH.supabaseUrl; // local dev-server serves content without login
  if (!devMode && !SESSION) { renderLogin(); return; }

  let me;
  try {
    me = await api('/api/me').then((r) => (r.ok ? r.json() : Promise.reject(r)));
  } catch {
    if (!devMode) { saveSession(null); renderLogin(); return; }
    $('#who').textContent = 'not authorized';
  }
  if (me) {
    $('#who').textContent = me.email || 'signed in';
    captureEnabled = Boolean(me.capture);
    editEnabled = Boolean(me.edit);
    recentEnabled = Boolean(me.recent);
  }
  if (!devMode) addSignOut();

  if (captureEnabled) setupCapture();
  setupChrome();

  if (!(await reloadBundle())) {
    $('#content').innerHTML = `<h1>Can't load the brain</h1><p class="muted">Backend error \u2014 the GITHUB_TOKEN secret may be missing, or your session expired. Try signing out and back in.</p>`;
    return;
  }

  buildNav();
  window.addEventListener('hashchange', route);
  route();
  $('#search').addEventListener('input', onSearch);
}

// Pull the whole brain into memory. Called at boot and after any write, so search
// and nav see a note edit immediately instead of on the next reload.
async function reloadBundle() {
  try {
    const data = await api('/api/bundle').then((r) => (r.ok ? r.json() : Promise.reject(r)));
    FILES = data.files || {};
    return true;
  } catch {
    return false;
  }
}

// Add a sign-out link to the sidebar footer.
function addSignOut() {
  const foot = $('.foot');
  if (!foot || $('#signOutBtn')) return;
  const a = document.createElement('a');
  a.id = 'signOutBtn'; a.href = '#'; a.textContent = 'sign out';
  a.addEventListener('click', (e) => { e.preventDefault(); signOut(); });
  foot.append(' \u00b7 ', a);
}

// ── chrome: mobile toggle + keyboard shortcuts ──────────────────────────────
function setupChrome() {
  $('#menuBtn')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); $('#search').focus(); return; }
    if (e.key === 'Escape') { $('#search').blur(); $('#sidebar').classList.remove('open'); return; }
    if (typing) return;
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      const i = navItems.indexOf(current);
      const next = e.key === 'j' ? Math.min(navItems.length - 1, i + 1) : Math.max(0, i - 1);
      if (navItems[next]) location.hash = '#/' + navItems[next];
    }
  });
}

// ── navigation ──────────────────────────────────────────────────────────────
function buildNav(filter = '') {
  const nav = $('#nav');
  nav.innerHTML = '';
  navItems = [];
  // pinned views
  const vg = document.createElement('div'); vg.className = 'group'; vg.textContent = 'Views'; nav.appendChild(vg);
  const addView = (id, label) => { const a = document.createElement('a'); a.className = 'item' + (current === id ? ' active' : ''); a.href = '#/' + id; a.append(viewIcon(id), document.createTextNode(label)); nav.appendChild(a); navItems.push(id); };
  addView('briefing', 'Briefing');
  addView('graph', 'Graph');
  if (recentEnabled) addView('recent', 'Recent');
  const bySection = {};
  for (const path of Object.keys(FILES)) (bySection[sectionOf(path)] ||= []).push(path);
  const sections = [...new Set([...SECTION_ORDER, ...Object.keys(bySection)])];
  for (const sec of sections) {
    let items = (bySection[sec] || []).sort(cmp);
    if (filter) items = items.filter((p) => matches(p, filter, FILES[p], titleOf));
    if (!items.length) continue;
    const g = document.createElement('div');
    g.className = 'group';
    g.textContent = SECTION_LABEL[sec] || sec;
    nav.appendChild(g);
    for (const p of items) {
      navItems.push(p);
      const a = document.createElement('a');
      a.className = 'item' + (p === current ? ' active' : '');
      a.textContent = titleOf(FILES[p], p);
      a.href = '#/' + p;
      nav.appendChild(a);
    }
  }
}

function route() {
  const raw = decodeURIComponent(location.hash.replace(/^#\//, ''));
  if (raw === 'graph') { current = 'graph'; renderGraph(); buildNav($('#search').value.trim()); return; }
  if (raw === 'briefing') { current = 'briefing'; renderBriefing(); buildNav($('#search').value.trim()); return; }
  if (raw === 'recent' && recentEnabled) { current = 'recent'; renderRecent(); buildNav($('#search').value.trim()); return; }
  if (raw === 'inbox' && captureEnabled) { current = 'inbox'; refreshInboxCount().then(renderInbox); buildNav($('#search').value.trim()); return; }
  if (raw.startsWith('search:')) { current = raw; renderSearch(raw.slice(7)); buildNav($('#search').value.trim()); return; }
  let path = raw;
  if (!FILES[path]) path = FILES['README.md'] ? 'README.md' : Object.keys(FILES).sort(cmp)[0];
  current = path;
  renderNote(path);
  buildNav($('#search').value.trim());
}

// ── rendering ────────────────────────────────────────────────────────────────
function renderNote(path) {
  const el = $('#content');
  el.innerHTML = window.marked.parse(FILES[path] || '# Not found');
  el.parentElement.scrollTop = 0;
  rewriteLinks(path, el);
  addHeadingIds(el);
  injectToc(el);
  addCodeCopy(el);
  renderBacklinks(path, el);
  if (editEnabled && FILES[path] !== undefined) addEditButton(path, el);
}

function rewriteLinks(path, el) {
  el.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:|#)/.test(href)) { if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; } return; }
    // Static assets (PDFs/images) live under /files/<name> and open in a new tab.
    if (/\.(pdf|png|jpe?g|gif|svg)(\?.*)?$/i.test(href)) {
      a.setAttribute('href', '/files/' + href.split('/').pop());
      a.target = '_blank'; a.rel = 'noopener';
      return;
    }
    const resolved = resolvePath(path, href.replace(/#.*$/, ''));
    if (resolved && (FILES[resolved] || resolved.endsWith('/'))) a.setAttribute('href', '#/' + resolved.replace(/\/$/, '/README.md'));
  });
}

function addHeadingIds(el) {
  el.querySelectorAll('h2, h3').forEach((h) => { if (!h.id) h.id = slugify(h.textContent); });
}

function injectToc(el) {
  const heads = [...el.querySelectorAll('h2')];
  if (heads.length < 4) return;
  const toc = document.createElement('details');
  toc.className = 'toc';
  toc.open = false;
  toc.innerHTML = '<summary>On this page</summary>';
  const ul = document.createElement('ul');
  for (const h of heads) {
    const li = document.createElement('li');
    li.innerHTML = `<a href="#${h.id}">${h.textContent}</a>`;
    ul.appendChild(li);
  }
  toc.appendChild(ul);
  const h1 = el.querySelector('h1');
  h1 ? h1.after(toc) : el.prepend(toc);
}

function addCodeCopy(el) {
  el.querySelectorAll('pre').forEach((pre) => {
    const btn = document.createElement('button');
    btn.className = 'copy';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pre.innerText); btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1200); } catch {}
    });
    pre.appendChild(btn);
  });
}

function renderBacklinks(path, el) {
  const back = backlinksFor(path, FILES).sort(cmp);
  if (!back.length) return;
  const box = document.createElement('div');
  box.className = 'backlinks';
  box.innerHTML = '<h2>Linked from</h2>';
  const ul = document.createElement('ul');
  for (const p of back) { const li = document.createElement('li'); li.innerHTML = `<a href="#/${p}">${titleOf(FILES[p], p)}</a>`; ul.appendChild(li); }
  box.appendChild(ul);
  el.appendChild(box);
}

// ── inline editing (commits to the private repo) ────────────────────────────
function addEditButton(path, el) {
  const btn = document.createElement('button');
  btn.className = 'edit-btn';
  btn.type = 'button';
  btn.textContent = '✎ Edit';
  btn.addEventListener('click', () => openEditor(path));
  el.prepend(btn);
}

function openEditor(path) {
  const el = $('#content');
  el.innerHTML = '';
  const bar = document.createElement('div');
  bar.className = 'editbar';
  bar.innerHTML = `<span class="editpath">${path}</span>`;
  const save = document.createElement('button'); save.textContent = 'Save'; save.className = 'primary';
  const propose = document.createElement('button'); propose.textContent = 'Propose PR'; propose.title = 'Open a pull request instead of committing to main';
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
  const status = document.createElement('span'); status.className = 'muted';
  bar.append(save, propose, cancel, status);
  const ta = document.createElement('textarea');
  ta.className = 'editor';
  ta.value = FILES[path];
  ta.spellcheck = false;
  el.append(bar, ta);
  ta.focus();

  cancel.addEventListener('click', () => renderNote(path));
  propose.addEventListener('click', async () => {
    const content = ta.value;
    if (!/^#\s+\S/m.test(content)) { status.textContent = 'needs an # H1 title'; return; }
    propose.disabled = true; status.textContent = 'opening PR…';
    try {
      const r = await api('/api/note-pr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || r.status);
      status.innerHTML = `PR #${body.number} opened — <a href="${body.pr}" target="_blank" rel="noopener">view</a>`;
    } catch (e) { status.textContent = 'error: ' + e.message; propose.disabled = false; }
  });
  save.addEventListener('click', async () => {
    const content = ta.value;
    if (!/^#\s+\S/m.test(content)) { status.textContent = 'needs an # H1 title'; return; }
    save.disabled = true; status.textContent = 'saving…';
    try {
      const r = await api('/api/note', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || r.status);
      FILES[path] = content;
      renderNote(path);
    } catch (e) { status.textContent = 'error: ' + e.message; save.disabled = false; }
  });
  ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save.click(); if (e.key === 'Escape') renderNote(path); });
}

// ── graph view (force-directed, dependency-free) ────────────────────────────
const SECTION_COLOR = {
  '': '#9aa3b2', career: '#3ddc97', projects: '#60a5fa', ideas: '#fbbf24',
  learnings: '#f472b6', infra: '#a78bfa', scripts: '#38bdf8',
};
function renderGraph() {
  const el = $('#content');
  const { nodes, edges } = graphData(FILES);
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const W = 1000, H = 700;
  nodes.forEach((n, i) => { const a = (i / nodes.length) * Math.PI * 2; n.x = W / 2 + Math.cos(a) * 250; n.y = H / 2 + Math.sin(a) * 220; n.deg = 0; });
  edges.forEach((e) => { nodes[idx.get(e.source)].deg++; nodes[idx.get(e.target)].deg++; });
  const E = edges.map((e) => [idx.get(e.source), idx.get(e.target)]);
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < nodes.length; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        const d2 = dx * dx + dy * dy || 0.01;
        const f = 5200 / d2;
        fx += dx * f; fy += dy * f;
      }
      fx += (W / 2 - nodes[i].x) * 0.02; fy += (H / 2 - nodes[i].y) * 0.02;
      nodes[i].vx = (nodes[i].vx || 0) * 0.85 + fx;
      nodes[i].vy = (nodes[i].vy || 0) * 0.85 + fy;
    }
    for (const [a, b] of E) {
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - 90) * 0.02;
      const ux = dx / d, uy = dy / d;
      nodes[a].vx += ux * f; nodes[a].vy += uy * f;
      nodes[b].vx -= ux * f; nodes[b].vy -= uy * f;
    }
    for (const n of nodes) { n.x += Math.max(-15, Math.min(15, n.vx)); n.y += Math.max(-15, Math.min(15, n.vy)); }
  }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'graph');
  for (const [a, b] of E) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', nodes[a].x); l.setAttribute('y1', nodes[a].y);
    l.setAttribute('x2', nodes[b].x); l.setAttribute('y2', nodes[b].y);
    l.setAttribute('class', 'g-edge');
    svg.appendChild(l);
  }
  for (const n of nodes) {
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'g-node');
    g.addEventListener('click', () => { location.hash = '#/' + n.id; });
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y);
    c.setAttribute('r', 5 + Math.min(8, n.deg));
    c.setAttribute('fill', SECTION_COLOR[n.section] || '#9aa3b2');
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', n.x + 9); t.setAttribute('y', n.y + 4);
    t.setAttribute('class', 'g-label');
    t.textContent = n.title;
    g.append(c, t);
    svg.appendChild(g);
  }
  el.innerHTML = '<h1>Graph</h1><p class="muted">The knowledge graph — every note and its links. Click a node to open it.</p>';
  el.appendChild(svg);
  el.parentElement.scrollTop = 0;
}

// ── recent changes + daily briefing ─────────────────────────────────────────
async function fetchRecentCommits() {
  try { return (await api('/api/recent').then((r) => r.json())).commits || []; } catch { return []; }
}

function commitRow(c, showSha = true) {
  const meta = (showSha ? escapeHtml(c.sha) + ' · ' : '') + escapeHtml(relativeTime(c.date));
  return `<li class="rc"><a href="${escapeHtml(safeUrl(c.url))}" target="_blank" rel="noopener" class="rc-msg">${escapeHtml(c.message)}</a><span class="rc-meta">${meta}</span></li>`;
}

async function renderRecent() {
  const el = $('#content');
  el.innerHTML = '<h1>Recently changed</h1><p class="muted">Loading…</p>';
  const commits = await fetchRecentCommits();
  const rows = commits.map((c) => commitRow(c)).join('');
  el.innerHTML = `<h1>🕒 Recently changed</h1><p class="muted">Latest commits to the brain repo.</p><ul class="recent">${rows || '<li class="muted">No recent commits.</li>'}</ul>`;
  el.parentElement.scrollTop = 0;
}

async function renderBriefing() {
  const el = $('#content');
  const now = FILES['now.md'] || '';
  const gaps = FILES['gaps.md'] || '';
  const inline = (window.marked && window.marked.parseInline) ? (s) => window.marked.parseInline(s) : escapeHtml;
  const list = (arr) => (arr.length ? `<ul>${arr.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>');

  el.innerHTML = `<h1>☀ Daily briefing</h1>
    <p class="muted">A deterministic snapshot assembled from the brain — no guesswork.</p>
    <div class="brief">
      <section><h2>Focus right now</h2>${list(sectionBullets(now, 'Focus right now'))}</section>
      <section><h2>Next moves</h2>${list(sectionBullets(now, 'Next moves'))}</section>
      <section><h2>Open tensions</h2>${list(sectionBullets(gaps, 'Unresolved strategic tensions'))}</section>
      <section><h2>Recently changed</h2><ul class="recent" id="brief-recent"><li class="muted">${recentEnabled ? 'Loading…' : 'Recent feed not configured.'}</li></ul></section>
      ${captureEnabled ? `<section><h2>Inbox</h2><p>${INBOX.length} unfiled capture${INBOX.length === 1 ? '' : 's'} — <a href="#/inbox">open the inbox</a>.</p></section>` : ''}
    </div>`;
  el.parentElement.scrollTop = 0;

  if (recentEnabled) {
    const commits = await fetchRecentCommits();
    const box = $('#brief-recent');
    if (box) box.innerHTML = commits.slice(0, 6).map((c) => commitRow(c, false)).join('') || '<li class="muted">No recent commits.</li>';
  }
}

// ── search ────────────────────────────────────
let searchTimer;
function onSearch(e) {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    buildNav(q);
    if (q.length >= 2) location.hash = '#/search:' + encodeURIComponent(q);
  }, 120);
}

function renderSearch(q) {
  const el = $('#content');
  const hits = rankHits(FILES, q, titleOf).map((h) => h.path);
  const cards = hits.map((p) => {
    const body = highlight(excerpt(FILES[p], q), q);
    return `<a class="hit" href="${escapeHtml('#/' + p)}"><div class="hit-title">${escapeHtml(titleOf(FILES[p], p))}</div><div class="hit-path">${escapeHtml(p)}</div><div class="hit-snip">${body}</div></a>`;
  }).join('');
  el.innerHTML = `<h1>Search</h1><p class="muted">${hits.length} result${hits.length === 1 ? '' : 's'} for “${escapeHtml(q)}”.</p><div class="hits">${cards || '<p class="muted">No matches.</p>'}</div>`;
  el.parentElement.scrollTop = 0;
}

// ── capture inbox ───────────────────────────────────────────────────────────
function setupCapture() {
  $('#capture').hidden = false;
  const t = $('#capText');
  $('#capSave').addEventListener('click', saveCapture);
  t.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveCapture(); });
  refreshInboxCount();
}
async function saveCapture() {
  const t = $('#capText');
  const text = t.value.trim();
  if (!text) return;
  $('#capSave').disabled = true;
  try {
    await api('/api/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    t.value = '';
    await refreshInboxCount();
    if (location.hash === '#/inbox') renderInbox();
  } finally { $('#capSave').disabled = false; }
}
async function refreshInboxCount() {
  try { INBOX = (await api('/api/captures').then((r) => r.json())).captures || []; } catch { INBOX = []; }
  const link = $('#inboxLink');
  if (link) link.textContent = `🗂 Inbox (${INBOX.length})`;
}
function renderInbox() {
  const el = $('#content');
  el.innerHTML = `<h1>Inbox</h1><p class="muted">Unfiled captures. File each into the brain, then mark it ✓.</p><ul class="inbox"></ul>`;
  const ul = el.querySelector('.inbox');
  if (!INBOX.length) { ul.outerHTML = '<p class="muted">Nothing to file. 🎉</p>'; return; }
  for (const c of INBOX) {
    const li = document.createElement('li');
    const text = document.createElement('div');
    text.className = 'cap-text';
    text.textContent = c.text; // XSS-safe
    li.append(text);
    // Auto-file suggestion: rank notes against the capture text.
    const targets = suggestTargets(c.text, FILES).slice(0, 2);
    if (targets.length) {
      const sugg = document.createElement('div');
      sugg.className = 'cap-sugg';
      sugg.append('→ file into: ');
      targets.forEach((t, i) => {
        const a = document.createElement('a');
        a.href = '#/' + t.path;
        a.textContent = titleOf(FILES[t.path], t.path);
        sugg.appendChild(a);
        if (i < targets.length - 1) sugg.append(' · ');
      });
      li.appendChild(sugg);
    }
    const actions = document.createElement('div');
    actions.className = 'cap-actions';
    const status = document.createElement('span');
    status.className = 'muted cap-status';

    // With write access, "File into note" appends the capture into the chosen note
    // (then marks it filed). Without it, we can only mark it filed (dismiss).
    if (editEnabled) {
      const sel = document.createElement('select');
      sel.className = 'cap-target';
      sel.setAttribute('aria-label', 'Target note');
      for (const t of suggestTargets(c.text, FILES).slice(0, 5)) {
        const o = document.createElement('option');
        o.value = t.path;
        o.textContent = titleOf(FILES[t.path], t.path);
        sel.appendChild(o);
      }
      const fileBtn = document.createElement('button');
      fileBtn.className = 'cap-file-into';
      fileBtn.type = 'button';
      fileBtn.textContent = 'File into note';
      fileBtn.addEventListener('click', async () => {
        if (!sel.value) return;
        fileBtn.disabled = true; status.textContent = 'filing…';
        try {
          const r = await api('/api/note-append', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: sel.value, text: c.text }) });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `error ${r.status}`);
          await api('/api/capture-file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: Number(c.id) }) });
          await reloadBundle(); // otherwise search still misses the text just filed
          await refreshInboxCount();
          buildNav($('#search').value.trim());
          renderInbox();
        } catch (e) { fileBtn.disabled = false; status.textContent = e.message; }
      });
      actions.append(sel, fileBtn);
    }

    const dismiss = document.createElement('button');
    dismiss.className = 'cap-file';
    dismiss.type = 'button';
    // Without write access this only marks the row filed — it does NOT write the
    // text into a note, so say so rather than claiming it was filed.
    dismiss.textContent = editEnabled ? '✓ dismiss' : '✓ mark done (not saved to a note)';
    dismiss.title = editEnabled
      ? 'Remove from the inbox without appending it to a note.'
      : 'Removes it from the inbox only. The text stays in the capture store but is not searchable until you add it to a note.';
    dismiss.addEventListener('click', async () => {
      if (!editEnabled && !confirm('This only clears it from the inbox — the text is NOT added to a note and stays unsearchable.\n\nCopy it somewhere first if you need it. Continue?')) return;
      await api('/api/capture-file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: Number(c.id) }) });
      await refreshInboxCount();
      renderInbox();
    });
    actions.append(dismiss, status);
    li.append(actions);
    ul.appendChild(li);
  }
}
