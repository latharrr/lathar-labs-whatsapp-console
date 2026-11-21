# One image for both the web server and the worker (docker-compose.prod.yml picks the command).
FROM node:26-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
COPY db/package.json db/
COPY web/package.json web/
COPY worker/package.json worker/
RUN npm ci

COPY . .
RUN npx prisma generate --schema db/prisma/schema.prisma && npm run build -w web
# The npm scripts pass --env-file=../.env; an empty file keeps them working. Real values come from the
# container environment, which takes precedence. No secrets are baked into the image.
RUN touch .env

ENV NODE_ENV=production
EXPOSE 3100
# Web server. The worker overrides this with: npm run start -w worker
CMD ["sh", "-c", "cd web && exec npx next start -p ${PORT:-3100}"]
