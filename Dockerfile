FROM node:24.11.1-bookworm-slim AS tests
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY . .
CMD ["npm", "run", "check"]
