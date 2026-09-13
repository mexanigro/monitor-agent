// P-04 (D-P4-2) — detección de anomalías, pura. Fallos: crítica sólo con DOS fallos seguidos separados ≥ 60 s,
// sin exigir baseline. Latencia: sigue exigiendo baseline (p95). Tasa de éxito: sólo con ≥ 10 métricas.
import type { Anomaly, BaselineRow, CheckType, MetricRow } from "./types.js";

export const CONSECUTIVE_FAILURES = 2;
export const MIN_GAP_BETWEEN_FAILURES_MS = 60_000;
export const MIN_METRICS_FOR_SUCCESS_RATE = 10;
/** Una baseline sirve para latencia sólo si se calculó en los últimos 7 días (desvío 1 de G1: p95 de junio → falsos positivos #97/#98). */
export const BASELINE_FRESH_MS = 7 * 24 * 60 * 60_000;

export function isBaselineFresh(baseline: BaselineRow | null, now: Date): boolean {
  return !!baseline && now.getTime() - baseline.computed_at.getTime() <= BASELINE_FRESH_MS;
}

function twoConsecutive(metrics: MetricRow[], pred: (m: MetricRow) => boolean): boolean {
  const [a, b] = metrics;
  return !!a && !!b && pred(a) && pred(b) && Math.abs(a.checked_at.getTime() - b.checked_at.getTime()) >= MIN_GAP_BETWEEN_FAILURES_MS;
}

export function detectAnomalies(clientId: string, checkType: CheckType, metrics: MetricRow[], baseline: BaselineRow | null, now: Date = new Date()): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (metrics.length === 0) return anomalies;
  const latest = metrics[0];

  if (checkType === "http" || checkType === "api") {
    if (twoConsecutive(metrics, (x) => !x.success)) {
      anomalies.push({ clientId, checkType, severity: "critical", description: `${checkType} check failed ${CONSECUTIVE_FAILURES} consecutive times: ${latest.error ?? "unknown error"}` });
    }
  }

  // Latencia: dos muestras consecutivas (≥ 60 s) por encima de 3× p95. Crítica sólo con baseline fresca (≤ 7 días);
  // con baseline vieja → warning sin email; sin baseline → nada (no hay umbral).
  if (baseline && baseline.p95_response_time_ms > 0 && latest.response_time_ms !== null) {
    const over3x = twoConsecutive(metrics, (x) => x.response_time_ms !== null && x.response_time_ms > baseline.p95_response_time_ms * 3);
    if (over3x && !isBaselineFresh(baseline, now)) {
      anomalies.push({ clientId, checkType, severity: "warning", notify: false, description: `response time >3x p95 for 2 consecutive checks but stale baseline (${baseline.p95_response_time_ms}ms, computed ${baseline.computed_at.toISOString().slice(0, 10)}) — no alert` });
    } else if (over3x) {
      anomalies.push({ clientId, checkType, severity: "critical", description: `response time >3x p95 baseline (${baseline.p95_response_time_ms}ms) for 2 consecutive checks: ${metrics[1].response_time_ms}ms, ${latest.response_time_ms}ms` });
    } else if (isBaselineFresh(baseline, now)) {
      const last3 = metrics.slice(0, 3);
      if (last3.length === 3 && last3.every((m) => m.response_time_ms !== null && m.response_time_ms > baseline.p95_response_time_ms * 1.5)) {
        anomalies.push({ clientId, checkType, severity: "warning", description: "response time exceeded 1.5x p95 baseline for 3 consecutive checks" });
      }
    }
  }

  if (metrics.length >= MIN_METRICS_FOR_SUCCESS_RATE) {
    const successRate = (metrics.filter((m) => m.success).length / metrics.length) * 100;
    if (successRate < 95) {
      anomalies.push({ clientId, checkType, severity: "warning", description: `success rate ${successRate.toFixed(1)}% in last ${metrics.length} checks (below 95%)` });
    }
  }

  if (checkType === "firestore" && baseline) {
    const last2 = metrics.slice(0, 2);
    if (last2.length === 2 && last2.every((m) => m.response_time_ms !== null && m.response_time_ms > 2_000)) {
      anomalies.push({ clientId, checkType, severity: "warning", description: "Firestore latency >2000ms for 2 consecutive checks" });
    }
  }
  return anomalies;
}
