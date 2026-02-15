# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

# Install build deps for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
COPY packages/server/package.json packages/server/

RUN npm ci

COPY packages/ packages/

RUN npx turbo run build

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

RUN npm ci --omit=dev

# Copy built artifacts
COPY packages/shared/ packages/shared/
COPY --from=builder /app/packages/server/dist/ packages/server/dist/
COPY --from=builder /app/packages/web/dist/ packages/web/dist/

# Clean up build tools
RUN apk del python3 make g++

ENV PORT=3001
ENV OPENCLAW_PATH=""

EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]
