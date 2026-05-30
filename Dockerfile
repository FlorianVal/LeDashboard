FROM node:20-bookworm AS builder
WORKDIR /app

COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/server/package*.json ./apps/server/
COPY packages/shared/package*.json ./packages/shared/

RUN npm install

COPY . .

RUN find . -name tsconfig.tsbuildinfo -delete
RUN npm --workspace @ledashboard/shared run build
RUN npm --workspace @ledashboard/web run build
RUN npm --workspace @ledashboard/server run build

RUN npm prune --omit=dev

FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/apps/web/dist ./public
COPY --from=builder /app/node_modules ./node_modules

RUN rm -rf ./node_modules/@ledashboard/shared && mkdir -p ./node_modules/@ledashboard/shared
COPY --from=builder /app/packages/shared/dist ./node_modules/@ledashboard/shared/dist
COPY --from=builder /app/packages/shared/package.json ./node_modules/@ledashboard/shared/package.json

COPY --from=builder /app/package.json ./
COPY --from=builder /app/apps/server/package.json ./package.server.json

RUN mkdir -p /app/data

EXPOSE 3000

ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/app/data/ledashboard.sqlite
ENV SOURCES_PATH=/app/sources.yaml

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
