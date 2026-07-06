// Prisma 7 keeps CLI connection settings here instead of schema.prisma.
// DATABASE_URL is injected by dotenv-cli in npm scripts or by Docker Compose.
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    // Runs on `prisma db seed`.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
