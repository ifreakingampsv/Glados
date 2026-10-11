FROM node:22-bookworm-slim AS base

# Install OpenSSL (Prisma) and Chromium (worker PDF rendering per D44/D65)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    chromium \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

# Default starts web; override startCommand with `npm run worker` for the worker service.
CMD ["npm", "run", "start"]
