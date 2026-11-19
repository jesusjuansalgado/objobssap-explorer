// Production server: serves the built Angular app and the /proxy endpoint.
// Usage: node server/server.mjs   (PORT, HOST, STATIC_DIR, PROXY_* env vars)
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleProxy, loadAllowedHosts } from './proxy-core.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(process.env.STATIC_DIR ?? join(here, '..', 'dist', 'objobssap-explorer', 'browser'));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No build found in ${root}. Run "npm run build" first.`);
  process.exit(1);
}

let allowed = loadAllowedHosts(join(root, 'services.json'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

function sendFile(res, file, cache) {
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  if (path === '/proxy') {
    // Re-read services.json so edits to the deployed file take effect without a restart.
    allowed = loadAllowedHosts(join(root, 'services.json'));
    return handleProxy(req, res, allowed);
  }
  if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  const file = normalize(join(root, path));
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403);
    return res.end();
  }
  if (existsSync(file) && statSync(file).isFile()) {
    // Hashed bundles are immutable; config files and index.html must stay fresh.
    const hashed = /-[A-Z0-9]{8,}\.(js|css)$/.test(file);
    return sendFile(res, file, hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
  }
  // Unknown paths get the app only when a browser navigates to them; other requests
  // (e.g. Aladin Lite probing for a local HiPS) need a real 404 to fail fast.
  if ((req.headers.accept ?? '').includes('text/html')) return sendFile(res, join(root, 'index.html'), 'no-cache');
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}).listen(port, host, () => {
  console.log(`Observability Explorer on http://${host}:${port}  (static: ${root})`);
  console.log(`Proxy allow-list: ${[...allowed].join(', ') || '(empty)'}${process.env.PROXY_ALLOW_ANY === '1' ? ' + any public host' : ''}`);
});
