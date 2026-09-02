// Server twin for the Worker / MCP tools. To guarantee the API search and the
// browser UI behave IDENTICALLY (and never drift), this re-exports the ONE
// canonical, dependency-free search engine from the frontend's pure lib.js —
// which has no DOM references and bundles cleanly into the Worker.
export { titleOf, resolvePath, backlinksFor, excerpt, fold, tokenize, rankHits as rank } from '../public/lib.js';
