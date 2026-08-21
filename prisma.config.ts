import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import path from "node:path";

export default defineConfig({
  schema: path.join("prisma", "schema"),
  migrations: { path: path.join("prisma", "migrations") },
  datasource: { url: env("DATABASE_URL") },
});
