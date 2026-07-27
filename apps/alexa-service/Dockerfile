FROM node:24-slim AS build
WORKDIR /app
ENV CI=true
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @printdesk/alexa-service build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
CMD ["node", "apps/alexa-service/dist/main.js"]
