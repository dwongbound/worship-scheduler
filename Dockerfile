# Production image. Kept single-stage on purpose — simpler to read and debug
# at the cost of some image size. Switch to a multi-stage standalone build
# later if size matters.
FROM node:24-alpine

# Recurring set times are interpreted in this zone (see lib/dates.ts). Set it
# here so hosts that build straight from this Dockerfile (no docker-compose
# env_file) still get the right zone by default; override via platform env
# vars if needed.
ENV TZ=America/Los_Angeles

WORKDIR /app

# Install deps first so docker layer-caches them across code changes.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Generate the prisma client and build the app.
RUN npx prisma generate && npm run build

EXPOSE 3000

# `prisma migrate deploy` applies committed migrations (prisma/migrations/)
# without prompting — safe to run on every boot.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
