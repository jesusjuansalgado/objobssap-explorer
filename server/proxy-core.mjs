// Shared logic for the CORS proxy used by `ng serve` (dev) and server.mjs (prod).
//
// ObjObsSAP services rarely send CORS headers, so the browser cannot call them
// directly. The proxy forwards GET requests to an allow-list of hosts only:
// the hosts in public/services.json plus PROXY_ALLOW_HOSTS (comma separated).
// PROXY_ALLOW_ANY=1 opens it to any public http(s) host (never private networks).

import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function loadAllowedHosts(servicesJsonPath) {
  const hosts = new Set();
  try {
    const { services } = JSON.parse(readFileSync(servicesJsonPath, 'utf8'));
    for (const s of services ?? []) {
      try { hosts.add(new URL(s.url).host.toLowerCase()); } catch { /* skip */ }
    }
  } catch (e) {
    console.warn(`[proxy] could not read ${servicesJsonPath}: ${e.message}`);
  }
  for (const h of (process.env.PROXY_ALLOW_HOSTS ?? '').split(',')) {
    if (h.trim()) hosts.add(h.trim().toLowerCase());
  }
  return hosts;
}

function isPrivateAddress(ip) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Validate a target URL; returns a URL object or throws an Error with `.status`. */
export async function checkTarget(raw, allowedHosts) {
  const fail = (status, msg) => Object.assign(new Error(msg), { status });
  let url;
  try { url = new URL(raw); } catch { throw fail(400, 'Missing or invalid url parameter'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fail(400, 'Only http(s) URLs can be proxied');
  const allowAny = process.env.PROXY_ALLOW_ANY === '1';
  if (!allowAny && !allowedHosts.has(url.host.toLowerCase())) {
    throw fail(403, `Host ${url.host} is not in the proxy allow-list (services.json or PROXY_ALLOW_HOSTS)`);
  }
  if (allowAny) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addrs.some((a) => isPrivateAddress(a.address))) throw fail(403, 'Private addresses cannot be proxied');
  }
  return url;
}

/** Forward a GET and stream the answer back (following redirects to allowed hosts). */
export async function forward(url, allowedHosts, res) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const upstream = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': 'objobssap-explorer-proxy', Accept: 'application/x-votable+xml, text/xml, */*' },
      signal: AbortSignal.timeout(Number(process.env.PROXY_TIMEOUT_MS ?? 60000)),
    });
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
      current = await checkTarget(new URL(upstream.headers.get('location'), current).href, allowedHosts);
      continue;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Proxied-Url': current.href,
    });
    res.end(body);
    return;
  }
  res.writeHead(508, { 'Content-Type': 'text/plain' });
  res.end('Too many redirects');
}

/** Node http handler for GET /proxy?url=... */
export async function handleProxy(req, res, allowedHosts) {
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET', 'Content-Type': 'text/plain' });
    res.end('Only GET is supported');
    return;
  }
  const target = new URL(req.url, 'http://local').searchParams.get('url') ?? '';
  try {
    const url = await checkTarget(target, allowedHosts);
    await forward(url, allowedHosts, res);
  } catch (e) {
    const status = e.status ?? (e.name === 'TimeoutError' ? 504 : 502);
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(e.status ? e.message : `Upstream error: ${e.message}`);
  }
}
