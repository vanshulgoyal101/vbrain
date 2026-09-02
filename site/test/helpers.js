// Shared test helpers: build a gzipped ustar tarball like GitHub's tarball API,
// so content/mcp/worker tests can stub the bundle fetch without duplicating code.
const enc = new TextEncoder();

// Build a minimal ustar tar buffer from { name: string-or-bytes }.
export function makeTar(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const header = new Uint8Array(512);
    enc.encodeInto(name, header.subarray(0, 100));
    // size in octal at offset 124 (11 digits, NUL-padded is fine)
    enc.encodeInto(data.length.toString(8).padStart(11, '0'), header.subarray(124, 135));
    header[156] = 0x30; // typeflag '0' = regular file
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // two-block end-of-archive marker
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) { out.set(b, off); off += b.length; }
  return out;
}

// gzip a byte array using the platform CompressionStream.
export async function gzip(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A fetch stub that returns the given files as one gzipped tarball (200),
// mimicking GitHub's `tarball/<ref>` endpoint. Prefixes an "owner-repo-sha/" root.
export async function tarballFetch(files, { root = 'o-r-sha', status = 200 } = {}) {
  const prefixed = Object.fromEntries(Object.entries(files).map(([k, v]) => [`${root}/${k}`, v]));
  const gz = await gzip(makeTar(prefixed));
  return async () => new Response(gz, { status });
}
