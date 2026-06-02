import { getActiveClients } from "./clients.js";
import { httpCheck } from "./checks/httpCheck.js";
import { apiCheck } from "./checks/apiCheck.js";
import { firestoreCheck } from "./checks/firestoreCheck.js";
import { bookingCheck } from "./checks/bookingCheck.js";
import { analyzeClient } from "./analyzer.js";
import { db } from "./db/client.js";
import { reportRound } from "./health.js";
import type { MonitoredClient, CheckResult, CheckType } from "./types.js";

const FAST_INTERVAL_MS = 5 * 60_000;
const SLOW_INTERVAL_MS = 30 * 60_000;
const CONCURRENCY = parseInt(process.env.MONITOR_CONCURRENCY ?? "10", 10);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process items with bounded concurrency. At most `limit` items run at once.
 */
async function runConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit: number,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

async function loop(name: "fast" | "slow", intervalMs: number, fn: () => Promise<number>): Promise<never> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    let clientCount = 0;
    try {
      clientCount = await fn();
    } catch (err) {
      console.error(`[scheduler:${name}] error:`, err);
    }
    const elapsed = Date.now() - start;
    reportRound(name, elapsed, clientCount);
    console.log(`[scheduler:${name}] round completed in ${(elapsed / 1000).toFixed(1)}s`);
    const wait = Math.max(0, intervalMs - elapsed);
    if (wait > 0) await sleep(wait);
  }
}

function logResult(r: CheckResult, clientName: string): void {
  const tag = r.success ? "OK" : "FAIL";
  console.log(`  [${r.checkType}] ${clientName}: ${tag} (${r.responseTimeMs}ms)${r.error ? ` — ${r.error}` : ""}`);
}

const ALL_CHECKS: CheckType[] = ["http", "api", "firestore", "booking"];

function clientHasCheck(client: MonitoredClient, check: CheckType): boolean {
  const enabled = client.checks ?? ALL_CHECKS;
  return enabled.includes(check);
}

async function checkClient(
  client: MonitoredClient,
  checkFns: { type: CheckType; fn: (c: MonitoredClient) => Promise<CheckResult> }[],
): Promise<void> {
  const applicable = checkFns.filter((c) => clientHasCheck(client, c.type));
  if (applicable.length === 0) return;

  const types = applicable.map((c) => c.type);
  const results = await Promise.all(applicable.map((c) => c.fn(client)));
  for (const r of results) logResult(r, client.name);
  await analyzeClient(client, types);
}

let lastPruneDay = -1;

async function pruneIfNewDay(): Promise<void> {
  const today = new Date().getUTCDate();
  if (today === lastPruneDay) return;
  lastPruneDay = today;
  try {
    const deleted = await db.pruneOldMetrics(30);
    if (deleted > 0) console.log(`[scheduler] pruned ${deleted} metrics older than 30 days`);
  } catch (err) {
    console.error("[scheduler] prune failed:", err);
  }
}

async function fastRound(): Promise<number> {
  await pruneIfNewDay();
  const clients = await getActiveClients();
  console.log(`[scheduler:fast] checking ${clients.length} client(s)`);

  const checks = [
    { type: "http" as CheckType, fn: httpCheck },
    { type: "api" as CheckType, fn: apiCheck },
  ];

  await runConcurrent(clients, (client) => checkClient(client, checks), CONCURRENCY);
  return clients.length;
}

async function slowRound(): Promise<number> {
  const clients = await getActiveClients();
  console.log(`[scheduler:slow] checking ${clients.length} client(s)`);

  const checks = [
    { type: "firestore" as CheckType, fn: firestoreCheck },
    { type: "booking" as CheckType, fn: bookingCheck },
  ];

  await runConcurrent(clients, (client) => checkClient(client, checks), CONCURRENCY);
  return clients.length;
}

export function startScheduler(): void {
  loop("fast", FAST_INTERVAL_MS, fastRound).catch((err) =>
    console.error("[scheduler:fast] fatal:", err),
  );
  loop("slow", SLOW_INTERVAL_MS, slowRound).catch((err) =>
    console.error("[scheduler:slow] fatal:", err),
  );
  console.log("[scheduler] started — fast: 5min, slow: 30min, concurrency: " + CONCURRENCY);
}
