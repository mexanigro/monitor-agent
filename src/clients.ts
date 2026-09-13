import { getDb } from "./firestore.js";
import { selectTargets } from "./targets.js";
import type { MonitoredClient } from "./types.js";

const CACHE_TTL_MS = 5 * 60_000;

let cached: MonitoredClient[] | null = null;
let cachedAt = 0;

/** P-04: sitios del hub en status active o demo + el hub + sonda opcional (ver targets.ts). */
export async function getActiveClients(): Promise<MonitoredClient[]> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const db = getDb();
  const snap = await db.collection("hub_clients").where("status", "in", ["active", "demo"]).get();
  const targets = selectTargets(snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })), process.env);

  cached = targets;
  cachedAt = now;
  console.log(`[clients] loaded ${targets.length} target(s): ${targets.map((t) => t.clientId).join(", ")}`);
  return targets;
}

export function invalidateClientCache(): void {
  cached = null;
  cachedAt = 0;
}
