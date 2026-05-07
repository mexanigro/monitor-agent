import { db } from "../db/client.js";
import type { CheckResult, MonitoredClient } from "../types.js";

const TIMEOUT_MS = 10_000;

export async function httpCheck(client: MonitoredClient): Promise<CheckResult> {
  const start = performance.now();
  let statusCode: number | undefined;

  try {
    const res = await fetch(client.url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });

    statusCode = res.status;
    const responseTimeMs = Math.round(performance.now() - start);
    const success = res.ok;

    await saveMetric(client.clientId, responseTimeMs, statusCode, success);

    return {
      clientId: client.clientId,
      checkType: "http",
      success,
      responseTimeMs,
      statusCode,
      error: success ? undefined : `HTTP ${statusCode}`,
    };
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start);
    const error = err instanceof Error ? err.message : String(err);

    await saveMetric(client.clientId, responseTimeMs, statusCode, false, error);

    return {
      clientId: client.clientId,
      checkType: "http",
      success: false,
      responseTimeMs,
      statusCode,
      error,
    };
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
       VALUES ($1, 'http', $2, $3, $4, $5)`,
      [clientId, responseTimeMs, statusCode ?? null, success, error ?? null],
    );
  } catch (dbErr) {
    console.error(`[httpCheck] failed to save metric for ${clientId}:`, dbErr);
  }
}
