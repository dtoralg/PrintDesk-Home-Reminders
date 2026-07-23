FROM node:24-slim AS build
WORKDIR /app
ENV CI=true
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @printdesk/notion-service build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
CMD ["node", "apps/notion-service/dist/main.js"]
