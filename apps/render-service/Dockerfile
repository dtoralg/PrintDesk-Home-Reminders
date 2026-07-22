FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @printdesk/render-service build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/printdesk-venv \
    && /opt/printdesk-venv/bin/pip install --no-cache-dir --requirement packages/ticket-renderer/requirements.txt \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PRINTDESK_PYTHON=/opt/printdesk-venv/bin/python
CMD ["node", "apps/render-service/dist/main.js"]
