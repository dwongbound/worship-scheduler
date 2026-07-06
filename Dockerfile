# Production image. Kept single-stage on purpose — simpler to read and debug
# at the cost of some image size. Switch to a multi-stage standalone build
# later if size matters.
FROM node:24-alpine

WORKDIR /app

# Install deps first so docker layer-caches them across code changes.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Generate the prisma client and build the app.
RUN npx prisma generate && npm run build

EXPOSE 3000

# `prisma db push` syncs the schema on boot. Once you care about migration
# history, switch to `prisma migrate deploy`.
CMD ["sh", "-c", "npx prisma db push && npm start"]
