import { db } from "./db/client.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { startHealthServer, stopHealthServer } from "./health.js";

async function main(): Promise<void> {
  const dbOk = await db.healthCheck();
  if (!dbOk) {
    console.error("[monitor] cannot connect to database — exiting");
    process.exit(1);
  }
  console.log("[monitor] database connected");

  await db.initSchema();
  console.log("[monitor] schema initialized");

  startScheduler();

  const port = parseInt(process.env.PORT || "8080", 10);
  startHealthServer(port);
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[monitor] received ${signal} — shutting down`);

  // 1. Stop accepting new health requests and prevent new scheduler rounds.
  stopScheduler();
  await stopHealthServer();

  // 2. Grace period so in-flight checks/queries can finish.
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  // 3. Close the DB pool and exit.
  try {
    await db.end();
  } catch (err) {
    console.error("[monitor] error closing db pool:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  console.error("[monitor] fatal:", err);
  process.exit(1);
});
