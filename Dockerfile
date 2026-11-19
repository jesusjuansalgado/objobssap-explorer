# Observability Explorer: builds the Angular app, then serves it with the
# zero-dependency Node server (static files + the /proxy endpoint).
#
# Build arguments:
#   BASE_HREF     URL path the app is served under, with slashes ("/" or "/objobssap/")
#   NPM_REGISTRY  npm registry for the build (e.g. an internal mirror)
#   NODE_VERSION  Node.js major version (Angular 22 needs 22.22.3+ or 24.15+)
# Optional build secret:
#   npm_ca        extra CA certificate (PEM) for networks that inspect HTTPS:
#                 docker build --secret id=npm_ca,src=corporate-ca.pem .
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS build
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG BASE_HREF=/
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --registry="$NPM_REGISTRY" --no-audit --no-fund
COPY . .
RUN npx ng build --base-href="$BASE_HREF"

FROM node:${NODE_VERSION}-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    # Lets the proxy honour HTTPS_PROXY/HTTP_PROXY/NO_PROXY when the server needs one to go out.
    NODE_USE_ENV_PROXY=1
COPY server ./server
COPY --from=build /app/dist/objobssap-explorer/browser ./dist/objobssap-explorer/browser
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server/server.mjs"]
