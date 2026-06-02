import { db } from "../db/client.js";
import { fetchWithRetry } from "./retry.js";
import type { CheckResult, MonitoredClient } from "../types.js";

const TIMEOUT_MS = 10_000;

export async function apiCheck(client: MonitoredClient): Promise<CheckResult> {
  const url = `${client.url}/api/health`;

  const { response: res, responseTimeMs, statusCode, error: fetchError } = await fetchWithRetry(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    "apiCheck",
    TIMEOUT_MS,
  );

  let success = res?.ok ?? false;
  let error: string | undefined = fetchError ?? undefined;
  let metadata: Record<string, unknown> | undefined;

  if (res?.ok) {
    try {
      const body = await res.json();
      metadata = { body };
      const status = (body as Record<string, unknown>).status;
      if (status !== "ok" && status !== "healthy") {
        success = false;
        error = `health status: ${String(status)}`;
      }
    } catch {
      success = false;
      error = "invalid JSON response from /api/health";
    }
  } else if (res && !res.ok) {
    error = `HTTP ${statusCode}`;
  }

  await saveMetric(client.clientId, responseTimeMs, statusCode, success, error, metadata);

  return { clientId: client.clientId, checkType: "api", success, responseTimeMs, statusCode, error, metadata };
}

async function saveMetric(
  clientId: string,
  responseTimeMs: number,
  statusCode: number | undefined,
  success: boolean,
  error?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO metrics (client_id, check_type, response_time_ms, status_code, success, error, metadata)
       VALUES ($1, 'api', $2, $3, $4, $5, $6)`,
      [clientId, responseTimeMs, statusCode ?? null, success, error ?? null, metadata ? JSON.stringify(metadata) : null],
    );
  } catch (dbErr) {
    console.error(`[apiCheck] failed to save metric for ${clientId}:`, dbErr);
  }
}
