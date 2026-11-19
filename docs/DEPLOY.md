# Deploying with Docker

This guide puts the Observability Explorer on a server: one container that serves the web app
and its `/proxy` endpoint, usually behind the web server that already handles your domain and
HTTPS.

```
browser ──HTTPS──▶ nginx / Apache ──HTTP──▶ container :8080 ──▶ ObjObsSAP services
   │                (your domain, TLS)        (app + /proxy)      (Swift, …)
   └──▶ CDS directly (Sesame name resolution, MocServer, HiPS tiles for Aladin Lite)
```

Every step below was tested with Docker 29, nginx 1.24 and Apache 2.4.

## 1. What the server needs

- **Docker** with BuildKit (Docker 23 or newer, the default since then) or Podman.
- **Outbound HTTPS from the container** to each service in `services.json`
  (`www.swift.psu.edu`, `vo-labs.dev`, …), directly or through an HTTP proxy (see §4).
- Nothing else: Node.js is inside the image and the server has no npm dependencies.

Users' **browsers** talk to CDS directly (`cds.unistra.fr`, `alasky.cds.unistra.fr` and the
HiPS mirrors), so those hosts must be reachable from where people use the app, not from the
server.

## 2. Build the image

```bash
git clone https://github.com/jesusjuansalgado/objobssap-explorer.git
```

```bash
cd objobssap-explorer
```

```bash
docker build -t objobssap-explorer .
```

Build arguments (`--build-arg NAME=value`):

| Argument | Default | Use it when |
|---|---|---|
| `BASE_HREF` | `/` | the app lives under a path, e.g. `https://example.org/objobssap/` → `--build-arg BASE_HREF=/objobssap/` (leading **and** trailing slash) |
| `NPM_REGISTRY` | `https://registry.npmjs.org/` | the build machine must use an internal npm mirror |
| `NODE_VERSION` | `24` | you need another Node.js major (22 also works) |

If your network inspects HTTPS with its own certificate authority, the build fails with
`SELF_SIGNED_CERT_IN_CHAIN`. Pass that CA's certificate (PEM) as a build secret; it is used
for `npm ci` only and is not stored in the image:

```bash
docker build --secret id=npm_ca,src=/path/to/corporate-ca.pem -t objobssap-explorer .
```

Example for a sub-path deployment that goes through an internal mirror:

```bash
docker build --build-arg BASE_HREF=/objobssap/ --build-arg NPM_REGISTRY=https://npm.example.org/repository/npm-public/ -t objobssap-explorer .
```

## 3. Run it

```bash
docker run -d --name objobssap-explorer --restart unless-stopped -p 127.0.0.1:8080:8080 objobssap-explorer
```

Binding to `127.0.0.1` keeps the container reachable only through your reverse proxy (§6).
Use `-p 8080:8080` to expose it directly.

Check it:

```bash
curl -s http://127.0.0.1:8080/healthz
```

```bash
curl -s "http://127.0.0.1:8080/proxy?url=https%3A%2F%2Fwww.swift.psu.edu%2Fvo%2Fobjobssap%2Fcapabilities" | head -c 200
```

The first prints `ok`. The second prints the start of an XML document, which proves the
container can reach an ObjObsSAP service. `docker ps` also shows the container as `healthy`
after about 30 s.

Or with Docker Compose, using the `compose.yaml` in the repository (it reads the settings
below from the environment or an `.env` file next to it):

```bash
BASE_HREF=/objobssap/ HOST_PORT=127.0.0.1:8080 docker compose up -d --build
```

## 4. Runtime settings

Pass with `-e NAME=value` (or in `compose.yaml`):

| Variable | Default | Meaning |
|---|---|---|
| `PROXY_ALLOW_HOSTS` | (empty) | extra hosts the proxy may reach, comma separated, e.g. `obs.example.org,vis.example.org:8443` |
| `PROXY_ALLOW_ANY` | off | `1` lets the proxy reach any **public** host (users' own services); private and link-local addresses stay blocked |
| `PROXY_TIMEOUT_MS` | `60000` | how long to wait for a service |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | (empty) | outbound proxy for the container's requests to the services, e.g. `-e HTTPS_PROXY=http://proxy.example.org:3128` |
| `PORT` | `8080` | port inside the container |

The proxy only forwards to hosts found in `services.json` plus `PROXY_ALLOW_HOSTS`; it is not
an open proxy unless you set `PROXY_ALLOW_ANY=1`.

## 5. Change the observatories without rebuilding

`services.json` (the observatory list) and `config.json` (Sesame URL, default survey, default
time span, …) are read by the browser at start-up, and `services.json` also by the proxy on
every request. Mount your own copies over the built ones:

```bash
mkdir -p deploy
```

```bash
docker cp objobssap-explorer:/app/dist/objobssap-explorer/browser/services.json deploy/
```

Edit `deploy/services.json`, then recreate the container with the file mounted:

```bash
docker rm -f objobssap-explorer
```

```bash
docker run -d --name objobssap-explorer --restart unless-stopped -p 127.0.0.1:8080:8080 -v "$PWD/deploy/services.json:/app/dist/objobssap-explorer/browser/services.json:ro" objobssap-explorer
```

Later edits take effect on the next page load, since the file is served with `no-cache`.
A new host in it is allowed by the proxy straight away. Some editors replace the file instead
of rewriting it, and a single-file mount then keeps showing the old one: run
`docker restart objobssap-explorer` if an edit does not show up. The format of each entry is
in the [README](../README.md#configure-a-deployment-no-rebuild-needed); keep the files readable
by everyone (`chmod 644`), because the container runs as an unprivileged user.

## 6. Put it behind your web server

### nginx

At the root of a (sub)domain, e.g. `https://observability.example.org/` (build with the
default `BASE_HREF=/`):

```nginx
server {
    listen 443 ssl;
    server_name observability.example.org;
    # ssl_certificate / ssl_certificate_key …

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }
}
```

Under a path of an existing site, e.g. `https://example.org/objobssap/` (build with
`BASE_HREF=/objobssap/`). The trailing slashes on both lines matter: they strip `/objobssap`
before the request reaches the container.

```nginx
location = /objobssap { return 301 /objobssap/; }
location /objobssap/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
}
```

Reload with `sudo nginx -t && sudo systemctl reload nginx`.

### Apache httpd

Enable the proxy modules once:

```bash
sudo a2enmod proxy proxy_http
```

Under a path (build with `BASE_HREF=/objobssap/`), inside the existing `<VirtualHost *:443>`:

```apache
RedirectMatch 301 ^/objobssap$ /objobssap/
ProxyPass        /objobssap/ http://127.0.0.1:8080/ timeout=90
ProxyPassReverse /objobssap/ http://127.0.0.1:8080/
```

At the root of a dedicated virtual host, use `ProxyPass / http://127.0.0.1:8080/ timeout=90`
and the matching `ProxyPassReverse`. Reload with
`sudo apachectl configtest && sudo systemctl reload apache2` (`httpd` on RHEL-like systems).

## 7. Update to a new version

```bash
git pull
```

```bash
docker build -t objobssap-explorer .
```

Repeat the same `--build-arg` options as the first build, then recreate the container with the
same `docker run` command as before (`docker rm -f objobssap-explorer` first), or with Compose:

```bash
docker compose up -d --build
```

## 8. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Blank page, browser console shows 404s for `main-….js` | `BASE_HREF` does not match the path the site is served under; rebuild with the right one |
| A timeline row says `HTTP 403 – Host … is not in the proxy allow-list` | add the host to `services.json` or `PROXY_ALLOW_HOSTS` |
| A row says `HTTP 502 – Upstream error: fetch failed`, or `504` | the container cannot reach that service: check firewall rules or set `HTTPS_PROXY` |
| A row says `HTTP 400`/`500` followed by the service's own message | the service rejected or failed the query (e.g. Gaia outside its ephemeris range); nothing to fix on your side |
| The sky view stays black or grey | the user's browser cannot reach the CDS HiPS servers (network filter on their side) |
| Build fails at `npm ci` with `SELF_SIGNED_CERT_IN_CHAIN` | pass your CA with `--secret id=npm_ca,src=…` (§2) |
| Build fails at `npm ci` with `E401`, `E403` or `E429` from an internal mirror | the mirror needs credentials or is rate-limiting; use `--build-arg NPM_REGISTRY=https://registry.npmjs.org/` if the build machine can reach it |

Logs: `docker logs objobssap-explorer` prints the static directory and the proxy allow-list
at start-up.
