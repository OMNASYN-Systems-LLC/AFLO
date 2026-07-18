import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config (ADR-0005). `generate` produces SQL migrations from the
 * schema offline — no database connection required, so it runs in CI and
 * locally without credentials. `migrate`/`push` need DATABASE_URL (Neon,
 * per-branch) and are run only from the deploy pipeline once the connection
 * lands; the URL enters via the provider dashboard, never the repo.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/aflo_placeholder",
  },
  strict: true,
  verbose: true,
});
