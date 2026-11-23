// Tiny static server for local smoke tests: serves game/ on http://localhost:PORT.
// Usage: node serve.ts [port]   (default 8080)
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), 'game');
const port = Number(process.argv[2] || 8080);
const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
};

createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = join(root, path);
    if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    const st = statSync(file);
    if (!st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, () => console.log(`serving game/ at http://localhost:${port}`));
