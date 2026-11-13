FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY tsconfig.json deploy-commands.ts ./
COPY scripts ./scripts
COPY src ./src
COPY assets ./assets
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production DATA_DIR=/app/data
USER node
CMD ["node", "--enable-source-maps", "dist/src/index.js"]
