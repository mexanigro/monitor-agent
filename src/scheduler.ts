import { getActiveClients } from "./clients.js";
import { httpCheck } from "./checks/httpCheck.js";
import { apiCheck } from "./checks/apiCheck.js";
import { firestoreCheck } from "./checks/firestoreCheck.js";
import { bookingCheck } from "./checks/bookingCheck.js";
import { analyzeClient } from "./analyzer.js";

const FAST_INTERVAL_MS = 5 * 60_000;
const SLOW_INTERVAL_MS = 30 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop(name: string, intervalMs: number, fn: () => Promise<void>): Promise<never> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    try {
      await fn();
    } catch (err) {
      console.error(`[scheduler:${name}] error:`, err);
    }
    const elapsed = Date.now() - start;
    const wait = Math.max(0, intervalMs - elapsed);
    if (wait > 0) await sleep(wait);
  }
}

function logResult(r: { checkType: string; success: boolean; responseTimeMs: number; error?: string }, clientName: string): void {
  const tag = r.success ? "OK" : "FAIL";
  console.log(`  [${r.checkType}] ${clientName}: ${tag} (${r.responseTimeMs}ms)${r.error ? ` — ${r.error}` : ""}`);
}

const ALL_CHECKS: import("./types.js").CheckType[] = ["http", "api", "firestore", "booking"];

function clientHasCheck(client: import("./types.js").MonitoredClient, check: import("./types.js").CheckType): boolean {
  const enabled = client.checks ?? ALL_CHECKS;
  return enabled.includes(check);
}

async function fastRound(): Promise<void> {
  const clients = getActiveClients();
  console.log(`[scheduler:fast] checking ${clients.length} client(s)`);

  for (const client of clients) {
    const checks: Promise<import("./types.js").CheckResult>[] = [];
    const types: import("./types.js").CheckType[] = [];

    if (clientHasCheck(client, "http"))  { checks.push(httpCheck(client));  types.push("http"); }
    if (clientHasCheck(client, "api"))   { checks.push(apiCheck(client));   types.push("api"); }

    if (checks.length === 0) continue;
    const results = await Promise.all(checks);
    for (const r of results) logResult(r, client.name);
    await analyzeClient(client, types);
  }
}

async function slowRound(): Promise<void> {
  const clients = getActiveClients();
  console.log(`[scheduler:slow] checking ${clients.length} client(s)`);

  for (const client of clients) {
    const checks: Promise<import("./types.js").CheckResult>[] = [];
    const types: import("./types.js").CheckType[] = [];

    if (clientHasCheck(client, "firestore")) { checks.push(firestoreCheck(client)); types.push("firestore"); }
    if (clientHasCheck(client, "booking"))   { checks.push(bookingCheck(client));    types.push("booking"); }

    if (checks.length === 0) continue;
    const results = await Promise.all(checks);
    for (const r of results) logResult(r, client.name);
    await analyzeClient(client, types);
  }
}

export function startScheduler(): void {
  loop("fast", FAST_INTERVAL_MS, fastRound).catch((err) =>
    console.error("[scheduler:fast] fatal:", err),
  );
  loop("slow", SLOW_INTERVAL_MS, slowRound).catch((err) =>
    console.error("[scheduler:slow] fatal:", err),
  );
  console.log("[scheduler] started — fast: 5min, slow: 30min");
}
