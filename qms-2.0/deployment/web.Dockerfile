FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN --mount=type=cache,id=qms2-pnpm-store,target=/pnpm/store \
    PNPM_CONFIG_STORE_DIR=/pnpm/store corepack pnpm --filter @qms/web... install --frozen-lockfile && \
    corepack pnpm --filter @qms/web build

FROM nginx:1.29-alpine
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
