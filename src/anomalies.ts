// P-04 (D-P4-2) — detección de anomalías, pura. Fallos: crítica sólo con DOS fallos seguidos separados ≥ 60 s,
// sin exigir baseline. Latencia: sigue exigiendo baseline (p95). Tasa de éxito: sólo con ≥ 10 métricas.
import type { Anomaly, BaselineRow, CheckType, MetricRow } from "./types.js";

export const CONSECUTIVE_FAILURES = 2;
export const MIN_GAP_BETWEEN_FAILURES_MS = 60_000;
export const MIN_METRICS_FOR_SUCCESS_RATE = 10;

export function detectAnomalies(clientId: string, checkType: CheckType, metrics: MetricRow[], baseline: BaselineRow | null): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (metrics.length === 0) return anomalies;
  const latest = metrics[0];

  if (checkType === "http" || checkType === "api") {
    const [a, b] = metrics;
    const twoFailures = a && b && !a.success && !b.success &&
      Math.abs(a.checked_at.getTime() - b.checked_at.getTime()) >= MIN_GAP_BETWEEN_FAILURES_MS;
    if (twoFailures) {
      anomalies.push({ clientId, checkType, severity: "critical", description: `${checkType} check failed ${CONSECUTIVE_FAILURES} consecutive times: ${latest.error ?? "unknown error"}` });
    }
  }

  if (baseline && latest.response_time_ms !== null && baseline.p95_response_time_ms > 0) {
    if (latest.response_time_ms > baseline.p95_response_time_ms * 3) {
      anomalies.push({ clientId, checkType, severity: "critical", description: `response time ${latest.response_time_ms}ms is >3x p95 baseline (${baseline.p95_response_time_ms}ms)` });
    } else {
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
