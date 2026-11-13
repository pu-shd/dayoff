FROM node:24.11.1-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY scripts/instance.ts ./scripts/instance.ts
COPY src/domain.ts ./src/domain.ts
CMD ["node", "scripts/instance.ts", "validate", "--instance", "/instance"]
