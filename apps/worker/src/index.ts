import { JOB_REGISTRY } from "./jobs.js";

/**
 * AFLO worker — Railway service entry point.
 *
 * V1 slice: a stub that proves the deploy target and enumerates the jobs it
 * will own. It intentionally does nothing else: no database, no network.
 */

function main(): void {
  console.log("AFLO worker starting (stub — no jobs are executed yet)");
  for (const job of JOB_REGISTRY) {
    console.log(`  registered job: ${job.name} [${job.cadence}] — ${job.description}`);
  }

  if (process.env.WORKER_HEARTBEAT === "1") {
    // Keep the process alive so platform health checks pass once deployed.
    setInterval(() => {
      console.log(`heartbeat ${new Date().toISOString()}`);
    }, 60_000);
  } else {
    console.log("WORKER_HEARTBEAT not set — exiting cleanly.");
  }
}

main();
