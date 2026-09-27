FROM node:24.21.0-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY . .
RUN corepack pnpm install --frozen-lockfile && corepack pnpm --filter @qms/api build
ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
