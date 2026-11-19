# Build the Angular app, then serve it with the zero-dependency Node server (static files + /proxy).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY server ./server
COPY --from=build /app/dist/objobssap-explorer/browser ./dist/objobssap-explorer/browser
USER node
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/server.mjs"]
