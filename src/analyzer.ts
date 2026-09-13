import { db } from "./db/client.js";
import { runAgent, isAgentEnabled } from "./agent.js";
import { detectAnomalies } from "./anomalies.js";
import { execute as writeIncidentExec } from "./tools/writeIncident.js";
import { sendResolvedEmail } from "./notifications.js";
import type { BaselineRow, CheckType, MetricRow, MonitoredClient } from "./types.js";

const MIN_CHECKS_FOR_BASELINE = 10;
// P-04 desvío 1: la baseline se recalcula cada hora sobre los últimos 7 días; con menos de 10 muestras en la ventana no hay baseline.
const BASELINE_MAX_AGE_MS = 60 * 60_000;
const BASELINE_WINDOW_DAYS = 7;

export async function analyzeClient(client: MonitoredClient, checkTypes: CheckType[]): Promise<void> {
  for (const checkType of checkTypes) {
    try {
      await analyzeCheckType(client, checkType);
      await tryAutoResolve(client.clientId, checkType);
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
    } else if (baseline) {
      // Baseline heredada sin datos recientes que la respalden: se retira para no comparar contra otra época.
      await db.query(`DELETE FROM baselines WHERE client_id = $1 AND check_type = $2`, [clientId, checkType]);
      baseline = null;
    }
  }

  // P-04: los fallos se detectan sin baseline (dos seguidos ≥ 60 s); la latencia sigue exigiéndola (anomalies.ts).
  const anomalies = detectAnomalies(clientId, checkType, metrics, baseline ?? null);
  if (anomalies.length === 0) return;

  const hasOpenIncident = await hasUnresolvedIncident(clientId, checkType);
  if (hasOpenIncident) return;

  const worst = anomalies.reduce((a, b) =>
    a.severity === "critical" && b.severity !== "critical" ? a : b,
  );

  console.log(`[analyzer] anomaly detected: ${worst.severity} — ${clientId}/${checkType}: ${worst.description}`);

  if (worst.severity !== "critical") {
    await writeIncidentExec({
      notify: worst.notify,
      clientId: client.clientId,
      severity: worst.severity,
      checkType,
      description: worst.description,
      claudeDiagnosis: "Registrado automáticamente — diagnóstico IA solo para incidentes críticos",
      actionTaken: "requires manual review",
    });
    return;
  }

  if (!isAgentEnabled() || !baseline) {
    await writeIncidentExec({
      clientId: client.clientId,
      severity: worst.severity,
      checkType,
      description: worst.description,
      claudeDiagnosis: "Sin diagnóstico IA (agente apagado: MONITOR_AGENT_ENABLED ≠ true) — revisar manualmente",
      actionTaken: "requires manual intervention",
    });
    return;
  }

  await runAgent(client, worst, metrics, baseline);
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
    `SELECT COUNT(*)::int AS count FROM metrics
     WHERE client_id = $1 AND check_type = $2 AND success = TRUE AND response_time_ms IS NOT NULL
       AND checked_at > NOW() - ($3 || ' days')::interval`,
    [clientId, checkType, String(BASELINE_WINDOW_DAYS)],
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
       WHERE client_id = $1 AND check_type = $2 AND response_time_ms IS NOT NULL AND success = TRUE
         AND checked_at > NOW() - ($3 || ' days')::interval
       ORDER BY checked_at DESC
       LIMIT 100
     ) recent`,
    [clientId, checkType, String(BASELINE_WINDOW_DAYS)],
  );

  const raw = rows[0] as { avg_response_time_ms: number; p95_response_time_ms: number; success_rate: number };

  const fallbackP95: Record<CheckType, number> = {
    http: 3000, api: 5000, firestore: 8000, booking: 10000,
  };
  const stats = {
    ...raw,
    p95_response_time_ms: raw.p95_response_time_ms || fallbackP95[checkType],
  };

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

const RECOVERY_CHECKS_NEEDED = 3;

async function tryAutoResolve(clientId: string, checkType: CheckType): Promise<void> {
  const { rows: openIncidents } = await db.query(
    `SELECT id, description, created_at FROM incidents WHERE client_id = $1 AND check_type = $2 AND resolved = FALSE`,
    [clientId, checkType],
  );

  if (openIncidents.length === 0) return;

  const recentMetrics = await getRecentMetrics(clientId, checkType, RECOVERY_CHECKS_NEEDED);
  if (recentMetrics.length < RECOVERY_CHECKS_NEEDED) return;

  const allHealthy = recentMetrics.every((m) => m.success);
  if (!allHealthy) return;

  for (const incident of openIncidents) {
    const inc = incident as { id: number; description: string; created_at: Date };
    await db.query(
      `UPDATE incidents SET resolved = TRUE, resolved_at = NOW() WHERE id = $1`,
      [inc.id],
    );
    console.log(`[analyzer] auto-resolved incident #${inc.id} (${clientId}/${checkType}) — ${RECOVERY_CHECKS_NEEDED} consecutive healthy checks`);

    try {
      await sendResolvedEmail(clientId, checkType, inc.description, inc.created_at);
    } catch (err) {
      console.error(`[analyzer] failed to send resolved email for incident #${inc.id}:`, err);
    }
  }
}
