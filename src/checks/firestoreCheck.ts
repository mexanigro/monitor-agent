import { db } from "../db/client.js";
import type { CheckResult, MonitoredClient } from "../types.js";

const TIMEOUT_MS = 10_000;
const LATENCY_THRESHOLD_MS = 2_000;

export async function firestoreCheck(client: MonitoredClient): Promise<CheckResult> {
  const url = `${client.url}/api/tenant/status`;
  const start = performance.now();
  let statusCode: number | undefined;

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    statusCode = res.status;
    const responseTimeMs = Math.round(performance.now() - start);

    let error: string | undefined;
    let success = res.ok && responseTimeMs < LATENCY_THRESHOLD_MS;

    if (!res.ok) {
      error = `HTTP ${statusCode}`;
    } else {
      const body = await res.json().catch(() => null);
      if (!body || !body.active) {
        success = false;
        error = body ? `tenant status: ${body.status}` : "invalid response body";
      } else if (responseTimeMs >= LATENCY_THRESHOLD_MS) {
        success = false;
        error = `latency ${responseTimeMs}ms exceeds ${LATENCY_THRESHOLD_MS}ms threshold`;
      }
    }

    await saveMetric(client.clientId, responseTimeMs, statusCode, success, error);
    return { clientId: client.clientId, checkType: "firestore", success, responseTimeMs, statusCode, error };
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start);
    const error = err instanceof Error ? err.message : String(err);
    await saveMetric(client.clientId, responseTimeMs, statusCode, false, error);
    return { clientId: client.clientId, checkType: "firestore", success: false, responseTimeMs, statusCode, error };
  }
}

async function saveMetric(
  clientId: string,
  responseTimeMs: number,
  statusCode: number | undefined,
  success: boolean,
  error?: string,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO metrics (client_id, check_type, response_time_ms, status_code, success, error)
       VALUES ($1, 'firestore', $2, $3, $4, $5)`,
      [clientId, responseTimeMs, statusCode ?? null, success, error ?? null],
    );
  } catch (dbErr) {
    console.error(`[firestoreCheck] failed to save metric for ${clientId}:`, dbErr);
  }
}
