# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# RUN npm ci --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public env vars (non-secret, baked into the JS bundle)
ARG NEXT_PUBLIC_SPACETIMEDB_URL
ARG NEXT_PUBLIC_SPACETIMEDB_MODULE
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_DEEPGRAM_MODEL
ARG NEXT_PUBLIC_DEEPGRAM_LANGUAGE
ARG NEXT_PUBLIC_DEEPGRAM_API_KEY

ENV NEXT_PUBLIC_SPACETIMEDB_URL=$NEXT_PUBLIC_SPACETIMEDB_URL
ENV NEXT_PUBLIC_SPACETIMEDB_MODULE=$NEXT_PUBLIC_SPACETIMEDB_MODULE
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_DEEPGRAM_MODEL=$NEXT_PUBLIC_DEEPGRAM_MODEL
ENV NEXT_PUBLIC_DEEPGRAM_LANGUAGE=$NEXT_PUBLIC_DEEPGRAM_LANGUAGE
ENV NEXT_PUBLIC_DEEPGRAM_API_KEY=$NEXT_PUBLIC_DEEPGRAM_API_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Only copy what Next.js needs to run
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3001

# next start is replaced by the standalone server.js
CMD ["node", "server.js"]
