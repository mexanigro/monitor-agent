/**
 * P-04 (Capa A, p04-monitor-v1) — qué vigila el monitor. RED sobre 85ed672: clients.ts sólo tomaba status "active"
 * (1 sitio; los 4 demos del lunes fuera) y no existía objetivo fijo para el hub ni sonda de prueba.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { selectTargets, HUB_TARGET, PROBE_CLIENT_ID } from "./targets.js";

const doc = (id: string, data: Record<string, unknown>) => ({ id, data });
const DOCS = [
  doc("d1", { clientId: "client_barber_01", status: "active", deployUrl: "https://barber-shop-template-ten.vercel.app/", businessName: "Madre" }),
  doc("d2", { clientId: "demo-gooli-ink", status: "demo", deployUrl: "https://demo-gooli-ink.arzac.studio", monitorChecks: ["http", "api"] }),
  doc("d3", { clientId: "demo-velvet-muse", status: "suspended", deployUrl: "https://demo-velvet-muse.arzac.studio" }),
  doc("d4", { clientId: "demo-future-tattoo", status: "archived", deployUrl: "https://x.arzac.studio" }),
  doc("d5", { clientId: "sin-url", status: "demo" }),
];

test("active + demo con deployUrl entran; suspended/archived y sin deployUrl no; el hub siempre, sólo http", () => {
  const t = selectTargets(DOCS, {});
  const ids = t.map((x) => x.clientId);
  assert.deepEqual(ids, ["client_barber_01", "demo-gooli-ink", HUB_TARGET.clientId]);
  assert.deepEqual(t.find((x) => x.clientId === HUB_TARGET.clientId)!.checks, ["http"]);
  assert.equal(HUB_TARGET.url, "https://arzac.studio");
  assert.deepEqual(t[1].checks, ["http", "api"], "respeta monitorChecks");
  assert.deepEqual(t[0].checks, ["http", "api", "firestore", "booking"], "sin monitorChecks → todos");
});

test("MONITOR_PROBE_URL añade una sonda sólo http; sin la variable no hay sonda", () => {
  const withProbe = selectTargets(DOCS, { MONITOR_PROBE_URL: "https://no-existe-p04.arzac.studio" });
  const probe = withProbe.find((x) => x.clientId === PROBE_CLIENT_ID)!;
  assert.ok(probe);
  assert.deepEqual(probe.checks, ["http"]);
  assert.equal(selectTargets(DOCS, {}).some((x) => x.clientId === PROBE_CLIENT_ID), false);
  assert.equal(selectTargets(DOCS, { MONITOR_PROBE_URL: "   " }).some((x) => x.clientId === PROBE_CLIENT_ID), false);
});

test("sin documentos: el hub sigue vigilado (nunca 0 objetivos)", () => {
  assert.deepEqual(selectTargets([], {}).map((x) => x.clientId), [HUB_TARGET.clientId]);
});
