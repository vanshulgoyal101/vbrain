// MCP server for the brain — lets any AI agent (Claude Code, Codex, Cursor…)
// query vbrain as a tool. JSON-RPC 2.0, streamable-HTTP, protocol 2025-06-18.
// Mirrors the shape of ctx.example.com / mcp.example.com.
//
// Auth is a bearer token (MCP_TOKEN secret), checked in worker.js — agents can't
// do interactive sign-in, so /mcp uses its own bearer token instead (see docs/MCP.md).

import { json } from './http.js';
import { fetchBundle } from './content.js';
import { titleOf, rank, excerpt, backlinksFor } from './search.js';

const PROTOCOL = '2025-06-18';

export const TOOLS = [
  {
    name: 'search_brain',
    description: "Search the owner's second brain (projects, learnings, ideas, notes) and return the most relevant notes with excerpts.",
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number', description: '1–20, default 5' } }, required: ['query'] },
  },
  {
    name: 'get_note',
    description: 'Return the full markdown of one note by its path, e.g. "career/profile.md".',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'list_notes',
    description: 'List every note path in the brain.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_backlinks',
    description: 'List the notes that link TO a given note path — useful for traversing the knowledge graph.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

export async function callTool(name, args = {}, files, env, fetchImpl = fetch) {
  if (name === 'list_notes') return Object.keys(files).sort().join('\n');
  if (name === 'get_note') {
    const p = String(args.path || '');
    if (!files[p]) throw new Error(`note not found: ${p}`);
    return files[p];
  }
  if (name === 'get_backlinks') {
    const p = String(args.path || '');
    if (!files[p]) throw new Error(`note not found: ${p}`);
    const back = backlinksFor(p, files);
    if (!back.length) return `No notes link to ${p}.`;
    return back.map((b) => `- ${b} — ${titleOf(files[b], b)}`).join('\n');
  }
  if (name === 'search_brain') {
    const q = String(args.query || '');
    if (!q.trim()) throw new Error('query required');
    const max = Math.min(Math.max(1, Number(args.max_results) || 5), 20);
    const hits = rank(files, q).slice(0, max);
    if (!hits.length) return `No matches for: ${q}`;
    return hits.map((h) => `## ${titleOf(files[h.path], h.path)} — ${h.path}\n${excerpt(files[h.path], q)}`).join('\n\n');
  }
  throw new Error(`unknown tool: ${name}`);
}

export async function handleMcp(request, env, fetchImpl = fetch) {
  const msg = await request.json().catch(() => null);
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return json({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'invalid request' } }, 400);
  }
  const { id, method, params } = msg;
  const reply = (result) => json({ jsonrpc: '2.0', id, result });
  const fail = (code, message, status = 200) => json({ jsonrpc: '2.0', id, error: { code, message } }, status);

  try {
    if (method === 'initialize') return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'vbrain', version: '1.0.0' } });
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return new Response(null, { status: 204 });
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      const files = await fetchBundle(env, fetchImpl);
      try {
        return reply({ content: [{ type: 'text', text: await callTool(name, args, files, env, fetchImpl) }], isError: false });
      } catch (toolErr) {
        return reply({ content: [{ type: 'text', text: String(toolErr.message || toolErr) }], isError: true });
      }
    }
    return fail(-32601, `method not found: ${method}`);
  } catch (e) {
    return fail(-32603, String(e && e.message || e));
  }
}
