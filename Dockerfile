# ============================================
# Stage 1: Build
# ============================================
FROM node:18.20.4-alpine AS builder
WORKDIR /spooty

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY src/backend/package.json ./src/backend/
COPY src/frontend/package.json ./src/frontend/

RUN npm ci

# Copy source code
COPY . .
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:18.20.4-alpine
WORKDIR /spooty

# Install runtime dependencies
RUN apk add --no-cache ffmpeg redis curl \
    && addgroup -S spooty && adduser -S spooty -G spooty

# Copy built app and dependencies
COPY --from=builder /spooty/dist ./dist
COPY --from=builder /spooty/package.json ./package.json
COPY --from=builder /spooty/package-lock.json ./package-lock.json
COPY --from=builder /spooty/src/backend/package.json ./src/backend/
COPY --from=builder /spooty/src/frontend/package.json ./src/frontend/

# Install production deps only
RUN npm ci --omit=dev && rm -rf package.json package-lock.json src

# Copy env config
COPY --from=builder /spooty/src/backend/.env.docker ./.env

# Create data directories
RUN mkdir -p /spooty/dist/backend/downloads /spooty/dist/backend/config \
    && chown -R spooty:spooty /spooty

# Switch to non-root user
USER spooty

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/api || exit 1

CMD ["node", "dist/backend/main.js"]
