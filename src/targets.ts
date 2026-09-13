// P-04 (Capa A, p04-monitor-v1) — qué vigila el monitor. Puro: sin Firestore, sin env global.
// Antes (85ed672) sólo status "active" → 1 sitio; los demos del lunes quedaban fuera y el hub no se vigilaba.
import type { MonitoredClient, CheckType } from "./types.js";

export const ALL_CHECKS: CheckType[] = ["http", "api", "firestore", "booking"];
const MONITORED_STATUSES = new Set(["active", "demo"]);

/** El hub (landing de ventas + API de cobro). No expone /api/health → sólo http. */
export const HUB_TARGET: MonitoredClient = {
  clientId: "nichos-hub", name: "arzac.studio (hub)", url: "https://arzac.studio", vercelProjectId: "", niche: "hub", active: true, checks: ["http"],
};
/** Sonda controlada para probar la alerta (G3 de P-04): MONITOR_PROBE_URL=<dominio inexistente>. Quitar al cerrar. */
export const PROBE_CLIENT_ID = "monitor-probe";

export type TargetDoc = { id: string; data: Record<string, unknown> };

export function selectTargets(docs: TargetDoc[], env: Record<string, string | undefined>): MonitoredClient[] {
  const targets: MonitoredClient[] = [];
  for (const { id, data: d } of docs) {
    if (!MONITORED_STATUSES.has(String(d.status))) continue;
    if (typeof d.clientId !== "string" || typeof d.deployUrl !== "string" || !d.deployUrl) {
      console.warn(`[targets] skipping doc ${id}: missing clientId=${!!d.clientId} deployUrl=${!!d.deployUrl}`);
      continue;
    }
    targets.push({
      clientId: d.clientId, name: (d.businessName as string) || d.clientId, url: d.deployUrl,
      vercelProjectId: (d.vercelProjectId as string) || "", niche: (d.niche as string) || "", active: true,
      checks: Array.isArray(d.monitorChecks) ? (d.monitorChecks as CheckType[]) : ALL_CHECKS,
    });
  }
  targets.push(HUB_TARGET);
  const probe = env.MONITOR_PROBE_URL?.trim();
  if (probe) targets.push({ clientId: PROBE_CLIENT_ID, name: "sonda de prueba", url: probe, vercelProjectId: "", niche: "probe", active: true, checks: ["http"] });
  return targets;
}
