import { getDb } from "./firestore.js";
import type { MonitoredClient, CheckType } from "./types.js";

const CACHE_TTL_MS = 5 * 60_000;
const ALL_CHECKS: CheckType[] = ["http", "api", "firestore", "booking"];

let cached: MonitoredClient[] | null = null;
let cachedAt = 0;

export async function getActiveClients(): Promise<MonitoredClient[]> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const db = getDb();
  const snap = await db
    .collection("hub_clients")
    .where("status", "==", "active")
    .get();

  const clients: MonitoredClient[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.clientId || !d.deployUrl) {
      console.warn(`[clients] skipping doc ${doc.id}: missing clientId=${!!d.clientId} deployUrl=${!!d.deployUrl}`);
      continue;
    }
    clients.push({
      clientId: d.clientId as string,
      name: (d.businessName as string) || d.clientId,
      url: d.deployUrl as string,
      vercelProjectId: (d.vercelProjectId as string) || "",
      niche: (d.niche as string) || "",
      active: true,
      checks: (d.monitorChecks as CheckType[]) ?? ALL_CHECKS,
    });
  }

  if (clients.length === 0 && cached && cached.length > 0) {
    console.warn(`[clients] WARNING: Firestore returned 0 active clients — keeping cache of ${cached.length} client(s). Possible query issue.`);
    return cached;
  }

  cached = clients;
  cachedAt = now;
  console.log(`[clients] loaded ${clients.length} active client(s) from Firestore`);
  return clients;
}

export function invalidateClientCache(): void {
  cached = null;
  cachedAt = 0;
}
