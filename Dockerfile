# Production image for Nebius Serverless Endpoints (or any container host).
# Build:  docker build --platform linux/amd64 -t vouch .
# Run:    docker run -p 3000:3000 -e NEBIUS_API_KEY=... -e TAVILY_API_KEY=... vouch

FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 vouch
COPY --from=build --chown=vouch /app/.next/standalone ./
COPY --from=build --chown=vouch /app/.next/static ./.next/static
COPY --from=build --chown=vouch /app/public ./public
USER vouch
EXPOSE 3000
CMD ["node", "server.js"]
