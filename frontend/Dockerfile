# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter ekdrive-frontend...

COPY frontend frontend
RUN pnpm --filter ekdrive-frontend exec vite build

# nginx serves the built files and passes /api to the backend, which keeps the API on the
# same origin as the app — the session cookie is SameSite=Strict and depends on it.
FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
