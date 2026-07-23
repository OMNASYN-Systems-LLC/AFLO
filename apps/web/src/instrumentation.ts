/**
 * Next.js instrumentation — runs once per server instance at startup, before
 * the app serves any request. (It does NOT run during `next build`; build-time
 * prerendering is separately allowed by the demo gate in `lib/data.ts`, and
 * serving always passes through this gate first.)
 *
 * This is the fail-closed boot gate (production-conversion Phase 2, ADR-0017,
 * flipped to explicit demo opt-in by ADR-0048): it asserts the runtime
 * configuration and REFUSES TO START when anything is misconfigured —
 *
 *   - production (`APP_ENV=production`) with a demo/mock fallback selected, a
 *     required secret missing, or a preview database (ADR-0017);
 *   - development/preview with an UNRESOLVED runtime axis — no explicit
 *     `APP_ENV=demo` opt-in and no explicit `AUTH_MODE=clerk` +
 *     `REPOSITORY_MODE=postgres` selection. This is the PR #97 LOW-5 fix: a
 *     deployment that intended production but forgot `APP_ENV=production`
 *     and/or one of the mode variables used to land silently on the
 *     demo/synthetic runtime; now it refuses to serve (ADR-0048);
 *   - demo (`APP_ENV=demo`) with a contradictory real selection.
 *
 * The demo prototype therefore REQUIRES the explicit `APP_ENV=demo` opt-in:
 * local `pnpm dev` gets it from the committed `apps/web/.env.development`,
 * Playwright sets it in its webServer env, and the Vercel prototype
 * deployments must set it in the dashboard (see docs/deployment/DEPLOYMENT.md
 * §2). Only `test` mode (vitest) boots with nothing configured.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime evaluates the contract (not the edge runtime).
  // NOTE: the whole request surface is node today (no edge routes, no middleware).
  // If an edge route or `middleware.ts` is ever added, it runs its own `register()`
  // with NEXT_RUNTIME="edge" and would bypass this gate — such a route must not
  // touch demo/mock providers, or the gate must be extended to the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertRuntimeReady, RuntimeConfigError } = await import("@aflo/shared");
  try {
    const { mode } = assertRuntimeReady(process.env);
    console.log(`[aflo] runtime configuration OK — mode=${mode}`);
  } catch (err) {
    if (err instanceof RuntimeConfigError) {
      // Fail closed: log the aggregated problems (env-var names only, no values)
      // and rethrow so the misconfigured deployment refuses to serve.
      console.error(`[aflo] FATAL: refusing to start — ${err.message}`);
    }
    throw err;
  }
}
