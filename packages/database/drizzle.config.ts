import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config (ADR-0005). `generate` produces SQL migrations from the
 * schema offline — no database connection required, so it runs in CI and
 * locally without credentials. `migrate`/`push` need DATABASE_URL (Neon,
 * per-branch) and are run only from the deploy pipeline once the connection
 * lands; the URL enters via the provider dashboard, never the repo.
 */
export default defineConfig({
  // Include enums.ts so drizzle-kit discovers every pgEnum definition and
  // emits its CREATE TYPE (it only registers enums exported from a file in
  // this glob; schema.ts re-exported just one, so the rest were referenced by
  // columns but never created — an invalid migration on a clean database).
  schema: ["./src/schema.ts", "./src/enums.ts"],
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/aflo_placeholder",
  },
  strict: true,
  verbose: true,
});
