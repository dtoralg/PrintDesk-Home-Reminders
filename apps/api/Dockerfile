FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @printdesk/api build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PRINTDESK_BACKEND=gcp
COPY --from=build /app /app
CMD ["node", "apps/api/dist/main.js"]
