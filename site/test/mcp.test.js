import { describe, it, expect } from 'vitest';
import { handleMcp, callTool, TOOLS } from '../src/mcp.js';
import { makeTar, gzip } from './helpers.js';

const FILES = {
  'README.md': '# vbrain\nthe index',
  'career/profile.md': '# Profile\nAcme Corp analyst. pixel pixel pixel.',
  'projects/pixelpaws.md': '# PixelPaws\nthe focus project for ads',
};

const rpc = (method, params, id = 1) => new Request('https://brain/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });

describe('callTool', () => {
  it('lists notes', async () => {
    expect((await callTool('list_notes', {}, FILES)).split('\n')).toContain('career/profile.md');
  });
  it('gets a note', async () => {
    expect(await callTool('get_note', { path: 'projects/pixelpaws.md' }, FILES)).toContain('the focus project');
  });
  it('throws on missing note', async () => {
    await expect(callTool('get_note', { path: 'nope.md' }, FILES)).rejects.toThrow(/not found/);
  });
  it('ranks search hits (repeated term wins)', async () => {
    const out = await callTool('search_brain', { query: 'pixel' }, FILES);
    expect(out).toContain('career/profile.md');
  });
  it('rejects unknown tools', async () => {
    await expect(callTool('bogus', {}, FILES)).rejects.toThrow(/unknown tool/);
  });
  it('returns backlinks for a note', async () => {
    const files = {
      'career/profile.md': '# Profile\nlink to [ad](../projects/pixelpaws.md)',
      'projects/pixelpaws.md': '# PixelPaws\nthe focus',
    };
    const out = await callTool('get_backlinks', { path: 'projects/pixelpaws.md' }, files);
    expect(out).toContain('career/profile.md');
  });
  it('backlinks: none reported cleanly', async () => {
    expect(await callTool('get_backlinks', { path: 'projects/pixelpaws.md' }, FILES)).toMatch(/No notes link/);
  });
  it('backlinks: throws on missing note', async () => {
    await expect(callTool('get_backlinks', { path: 'nope.md' }, FILES)).rejects.toThrow(/not found/);
  });
});

describe('handleMcp', () => {
  it('initialize returns protocol + serverInfo', async () => {
    const res = await handleMcp(rpc('initialize'), {});
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe('vbrain');
    expect(body.result.protocolVersion).toBeTruthy();
  });
  it('tools/list returns the tools', async () => {
    const body = await (await handleMcp(rpc('tools/list'), {})).json();
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(['get_backlinks', 'get_note', 'list_notes', 'search_brain']);
    expect(TOOLS).toHaveLength(4);
  });
  it('rejects a non-2.0 message', async () => {
    const res = await handleMcp(new Request('https://brain/mcp', { method: 'POST', body: '{}' }), {});
    expect((await res.json()).error.code).toBe(-32600);
  });
  it('unknown method → -32601', async () => {
    expect((await (await handleMcp(rpc('frobnicate'), {})).json()).error.code).toBe(-32601);
  });
  it('notifications return 204', async () => {
    expect((await handleMcp(rpc('notifications/initialized'), {}, undefined)).status).toBe(204);
  });
  it('tools/call runs against the fetched bundle', async () => {
    const gz = await gzip(makeTar({ 'o-r-sha/career/profile.md': '# Profile\npixel pixel' }));
    const fetchImpl = async () => new Response(gz, { status: 200 });
    const env = { GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' };
    const res = await handleMcp(rpc('tools/call', { name: 'search_brain', arguments: { query: 'pixel' } }), env, fetchImpl);
    const body = await res.json();
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toContain('career/profile.md');
  });
  it('tools/call surfaces a tool error as isError', async () => {
    const gz = await gzip(makeTar({ 'o-r-sha/README.md': '# R' }));
    const fetchImpl = async () => new Response(gz, { status: 200 });
    const env = { GH_OWNER: 'o', GH_REPO: 'r', GITHUB_TOKEN: 't' };
    const res = await handleMcp(rpc('tools/call', { name: 'get_note', arguments: { path: 'nope.md' } }), env, fetchImpl);
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/not found/);
  });
});
