# syntax=docker/dockerfile:1

# Debian rather than Alpine: sharp and the Prisma engines both ship glibc builds, and the
# musl variants are a source of avoidable surprises.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

# Manifests first, so a source-only change does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter ekdrive-backend...

COPY backend backend
RUN pnpm --filter ekdrive-backend db:generate \
  && pnpm --filter ekdrive-backend build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# node_modules comes over as built: it holds the generated Prisma client and the native
# binaries for sharp, which are tied to this image.
COPY --from=build /app /app

EXPOSE 3000
USER node

# Migrations run on start: the schema a container boots with is the one its code expects.
CMD ["sh", "-c", "pnpm --filter ekdrive-backend exec prisma migrate deploy && node backend/dist/index.js"]
