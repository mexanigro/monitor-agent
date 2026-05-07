import { db } from "./db/client.js";
import { startScheduler } from "./scheduler.js";

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
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[monitor] received ${signal} — shutting down`);
  await db.end();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  console.error("[monitor] fatal:", err);
  process.exit(1);
});
