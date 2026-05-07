import { db } from "./db/client.js";
import { runAgent } from "./agent.js";
import type { Anomaly, BaselineRow, CheckType, MetricRow, MonitoredClient } from "./types.js";

const MIN_CHECKS_FOR_BASELINE = 10;
const BASELINE_MAX_AGE_MS = 24 * 60 * 60_000;
const FIRESTORE_LATENCY_THRESHOLD_MS = 2_000;

export async function analyzeClient(client: MonitoredClient, checkTypes: CheckType[]): Promise<void> {
  for (const checkType of checkTypes) {
    try {
      await analyzeCheckType(client, checkType);
    } catch (err) {
      console.error(`[analyzer] error analyzing ${client.clientId}/${checkType}:`, err);
    }
  }
}

async function analyzeCheckType(client: MonitoredClient, checkType: CheckType): Promise<void> {
  const { clientId } = client;
  const metrics = await getRecentMetrics(clientId, checkType, 10);
  if (metrics.length === 0) return;

  let baseline = await getBaseline(clientId, checkType);

  const baselineStale = baseline && (Date.now() - baseline.computed_at.getTime() > BASELINE_MAX_AGE_MS);

  if (!baseline || baselineStale) {
    const totalChecks = await getCheckCount(clientId, checkType);
    if (totalChecks >= MIN_CHECKS_FOR_BASELINE) {
      baseline = await computeAndSaveBaseline(clientId, checkType);
    } else if (!baseline) {
      return;
    }
  }

  const anomalies = detectAnomalies(clientId, checkType, metrics, baseline);
  if (anomalies.length === 0) return;

  const hasOpenIncident = await hasUnresolvedIncident(clientId, checkType);
  if (hasOpenIncident) return;

  const worst = anomalies.reduce((a, b) =>
    a.severity === "critical" && b.severity !== "critical" ? a : b,
  );

  console.log(`[analyzer] anomaly detected: ${worst.severity} — ${clientId}/${checkType}: ${worst.description}`);
  await runAgent(client, worst, metrics, baseline);
}

function detectAnomalies(
  clientId: string,
  checkType: CheckType,
  metrics: MetricRow[],
  baseline: BaselineRow,
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const latest = metrics[0];

  if ((checkType === "http" || checkType === "api") && !latest.success) {
    anomalies.push({
      clientId,
      checkType,
      severity: "critical",
      description: `${checkType} check failed: ${latest.error ?? "unknown error"}`,
    });
  }

  if (latest.response_time_ms !== null && baseline.p95_response_time_ms > 0) {
    if (latest.response_time_ms > baseline.p95_response_time_ms * 3) {
      anomalies.push({
        clientId,
        checkType,
        severity: "critical",
        description: `response time ${latest.response_time_ms}ms is >3x p95 baseline (${baseline.p95_response_time_ms}ms)`,
      });
    }

    const last3 = metrics.slice(0, 3);
    if (
      last3.length === 3 &&
      last3.every((m) => m.response_time_ms !== null && m.response_time_ms > baseline.p95_response_time_ms * 1.5)
    ) {
      anomalies.push({
        clientId,
        checkType,
        severity: "warning",
        description: `response time exceeded 1.5x p95 baseline for 3 consecutive checks`,
      });
    }
  }

  const successCount = metrics.filter((m) => m.success).length;
  const successRate = (successCount / metrics.length) * 100;
  if (successRate < 95) {
    anomalies.push({
      clientId,
      checkType,
      severity: "warning",
      description: `success rate ${successRate.toFixed(1)}% in last ${metrics.length} checks (below 95%)`,
    });
  }

  if (checkType === "firestore") {
    const last2 = metrics.slice(0, 2);
    if (
      last2.length === 2 &&
      last2.every((m) => m.response_time_ms !== null && m.response_time_ms > FIRESTORE_LATENCY_THRESHOLD_MS)
    ) {
      anomalies.push({
        clientId,
        checkType,
        severity: "warning",
        description: `Firestore latency >${FIRESTORE_LATENCY_THRESHOLD_MS}ms for 2 consecutive checks`,
      });
    }
  }

  return anomalies;
}

async function getRecentMetrics(clientId: string, checkType: CheckType, limit: number): Promise<MetricRow[]> {
  const { rows } = await db.query(
    `SELECT * FROM metrics WHERE client_id = $1 AND check_type = $2 ORDER BY checked_at DESC LIMIT $3`,
    [clientId, checkType, limit],
  );
  return rows as MetricRow[];
}

async function getBaseline(clientId: string, checkType: CheckType): Promise<BaselineRow | null> {
  const { rows } = await db.query(
    `SELECT * FROM baselines WHERE client_id = $1 AND check_type = $2`,
    [clientId, checkType],
  );
  return (rows[0] as BaselineRow) ?? null;
}

async function getCheckCount(clientId: string, checkType: CheckType): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM metrics WHERE client_id = $1 AND check_type = $2`,
    [clientId, checkType],
  );
  return (rows[0] as { count: number }).count;
}

async function computeAndSaveBaseline(clientId: string, checkType: CheckType): Promise<BaselineRow> {
  const { rows } = await db.query(
    `SELECT
       ROUND(AVG(response_time_ms))::int AS avg_response_time_ms,
       ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms))::int AS p95_response_time_ms,
       ROUND(COUNT(*) FILTER (WHERE success) * 100.0 / COUNT(*), 2) AS success_rate
     FROM (
       SELECT response_time_ms, success
       FROM metrics
       WHERE client_id = $1 AND check_type = $2 AND response_time_ms IS NOT NULL
       ORDER BY checked_at DESC
       LIMIT 100
     ) recent`,
    [clientId, checkType],
  );

  const stats = rows[0] as { avg_response_time_ms: number; p95_response_time_ms: number; success_rate: number };

  await db.query(
    `INSERT INTO baselines (client_id, check_type, avg_response_time_ms, p95_response_time_ms, success_rate)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id, check_type)
     DO UPDATE SET avg_response_time_ms = $3, p95_response_time_ms = $4, success_rate = $5, computed_at = NOW()`,
    [clientId, checkType, stats.avg_response_time_ms, stats.p95_response_time_ms, stats.success_rate],
  );

  console.log(`[analyzer] baseline computed for ${clientId}/${checkType}: avg=${stats.avg_response_time_ms}ms p95=${stats.p95_response_time_ms}ms rate=${stats.success_rate}%`);

  return {
    client_id: clientId,
    check_type: checkType as BaselineRow["check_type"],
    avg_response_time_ms: stats.avg_response_time_ms,
    p95_response_time_ms: stats.p95_response_time_ms,
    success_rate: Number(stats.success_rate),
    computed_at: new Date(),
  };
}

async function hasUnresolvedIncident(clientId: string, checkType: CheckType): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM incidents WHERE client_id = $1 AND check_type = $2 AND resolved = FALSE LIMIT 1`,
    [clientId, checkType],
  );
  return rows.length > 0;
}
