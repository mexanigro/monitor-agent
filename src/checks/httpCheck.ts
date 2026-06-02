import { db } from "../db/client.js";
import { fetchWithRetry } from "./retry.js";
import type { CheckResult, MonitoredClient } from "../types.js";

const TIMEOUT_MS = 10_000;

export async function httpCheck(client: MonitoredClient): Promise<CheckResult> {
  const { response: res, responseTimeMs, statusCode, error: fetchError } = await fetchWithRetry(
    client.url,
    { method: "GET", redirect: "follow" },
    "httpCheck",
    TIMEOUT_MS,
  );

  const success = res?.ok ?? false;
  const error = fetchError ?? (success ? undefined : `HTTP ${statusCode}`);

  await saveMetric(client.clientId, responseTimeMs, statusCode, success, error ?? undefined);

  return {
    clientId: client.clientId,
    checkType: "http",
    success,
    responseTimeMs,
    statusCode,
    error: error ?? undefined,
  };
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
