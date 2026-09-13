/**
 * P-04 — umbral de alerta (D-P4-2): dos fallos seguidos, sin exigir baseline; un fallo aislado no alerta.
 * RED sobre 85ed672: detectAnomalies marcaba crítica con UN fallo y sólo corría con baseline (≥ 10 checks).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies } from "./anomalies.js";
import type { MetricRow, BaselineRow } from "./types.js";

let n = 0;
const m = (success: boolean, rt = 300, minutesAgo = 0): MetricRow => ({
  id: ++n, client_id: "c", check_type: "http", response_time_ms: rt, status_code: success ? 200 : 503,
  success, error: success ? null : "HTTP 503", metadata: null, checked_at: new Date(Date.UTC(2026, 8, 14, 10, 30 - minutesAgo)),
});
const baseline: BaselineRow = { client_id: "c", check_type: "http", avg_response_time_ms: 300, p95_response_time_ms: 500, success_rate: 100, computed_at: new Date() };

test("un fallo aislado (último fallido, anterior sano) → sin anomalía crítica, con o sin baseline", () => {
  const metrics = [m(false, 300, 0), m(true, 300, 5), m(true, 300, 10)];
  assert.equal(detectAnomalies("c", "http", metrics, null).filter((a) => a.severity === "critical").length, 0);
  assert.equal(detectAnomalies("c", "http", metrics, baseline).filter((a) => a.severity === "critical").length, 0);
});

test("dos fallos seguidos (≥ 60 s entre sí) → crítica aunque no haya baseline", () => {
  const metrics = [m(false, 300, 0), m(false, 300, 5), m(true, 300, 10)];
  const crit = detectAnomalies("c", "http", metrics, null).filter((a) => a.severity === "critical");
  assert.equal(crit.length, 1);
  assert.match(crit[0].description, /2 consecutive/);
});

test("dos fallos con menos de 60 s entre sí no cuentan como seguidos (reintento inmediato)", () => {
  const a = m(false, 300, 0); const b = m(false, 300, 0); b.checked_at = new Date(a.checked_at.getTime() - 20_000);
  assert.equal(detectAnomalies("c", "http", [a, b], null).filter((x) => x.severity === "critical").length, 0);
});

test("la tasa de éxito < 95 % sólo avisa con ≥ 10 métricas (no con 1 fallo entre 3)", () => {
  assert.equal(detectAnomalies("c", "http", [m(false), m(true), m(true)], null).length, 0);
  const ten = [m(false, 300, 0), ...Array.from({ length: 9 }, (_, i) => m(true, 300, (i + 1) * 5))];
  assert.equal(detectAnomalies("c", "http", ten, null).some((a) => a.severity === "warning" && /success rate/.test(a.description)), true);
});

test("latencia: dos muestras >3× p95 con baseline fresca → crítica; sin baseline no se evalúa", () => {
  const metrics = [m(true, 2000, 0), m(true, 2100, 5)];
  const fresh = { ...baseline, computed_at: new Date("2026-09-14T09:00:00Z") };
  assert.equal(detectAnomalies("c", "http", metrics, fresh, new Date("2026-09-14T10:30:00Z")).some((a) => a.severity === "critical" && /p95/.test(a.description)), true);
  assert.equal(detectAnomalies("c", "http", metrics, null).length, 0);
});

// —— Corrección tras G1 (2026-09-13): desvío 1 — falsos positivos #97/#98 por latencia con UNA muestra y baseline de junio.
const juneBaseline: BaselineRow = { client_id: "c", check_type: "http", avg_response_time_ms: 100, p95_response_time_ms: 136, success_rate: 100, computed_at: new Date("2026-06-11T11:16:55Z") };
const freshBaseline: BaselineRow = { ...juneBaseline, computed_at: new Date("2026-09-14T09:00:00Z") };
const NOW = new Date("2026-09-14T10:30:00Z");

test("caso literal #97: una muestra de 593 ms contra p95 136 ms de junio → hoy nada crítico", () => {
  const metrics = [m(true, 593, 0), m(true, 120, 5), m(true, 118, 10)];
  const out = detectAnomalies("c", "http", metrics, juneBaseline, NOW);
  assert.equal(out.filter((a) => a.severity === "critical").length, 0);
});

test("baseline fresca (< 7 días): una muestra >3× p95 no basta; dos seguidas ≥ 60 s → crítica", () => {
  assert.equal(detectAnomalies("c", "http", [m(true, 593, 0), m(true, 120, 5)], freshBaseline, NOW).filter((a) => a.severity === "critical").length, 0);
  const crit = detectAnomalies("c", "http", [m(true, 593, 0), m(true, 3074, 5), m(true, 120, 10)], freshBaseline, NOW).filter((a) => a.severity === "critical");
  assert.equal(crit.length, 1);
  assert.match(crit[0].description, /2 consecutive/);
});

test("baseline vieja (> 7 días): dos muestras altas → sólo warning sin email (notify false); nunca crítica", () => {
  const out = detectAnomalies("c", "http", [m(true, 593, 0), m(true, 3074, 5)], juneBaseline, NOW);
  assert.equal(out.filter((a) => a.severity === "critical").length, 0);
  const w = out.find((a) => a.severity === "warning" && /stale baseline/.test(a.description));
  assert.ok(w, "warning por baseline vieja");
  assert.equal(w!.notify, false);
});
