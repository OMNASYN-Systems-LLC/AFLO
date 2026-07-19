/**
 * Next.js instrumentation — runs once per server instance at startup, before
 * the app serves any request.
 *
 * This is the fail-closed boot gate (production-conversion Phase 2, ADR-0017):
 * it asserts the runtime configuration and, in production, REFUSES TO START when
 * anything is misconfigured — a demo/mock fallback selected, a required secret
 * missing, a preview database, etc. Outside production it is permissive.
 *
 * Safe for the current prototype: production mode is entered only by an explicit
 * `APP_ENV=production`. With `APP_ENV` unset the runtime resolves to
 * `development`, `assertRuntimeReady` never throws, and the server boots
 * normally.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime evaluates the contract (not the edge runtime).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertRuntimeReady, RuntimeConfigError } = await import("@aflo/shared");
  try {
    const { mode } = assertRuntimeReady(process.env);
    console.log(`[aflo] runtime configuration OK — mode=${mode}`);
  } catch (err) {
    if (err instanceof RuntimeConfigError) {
      // Fail closed: log the aggregated problems (env-var names only, no values)
      // and rethrow so the misconfigured production deployment refuses to serve.
      console.error(`[aflo] FATAL: refusing to start — ${err.message}`);
    }
    throw err;
  }
}
