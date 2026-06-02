import { db } from "../db/client.js";
import type { CheckResult, MonitoredClient } from "../types.js";

const TIMEOUT_MS = 15_000;

interface StepResult {
  step: string;
  ok: boolean;
  statusCode?: number;
  timeMs: number;
  error?: string;
  body?: unknown;
}

export async function bookingCheck(client: MonitoredClient): Promise<CheckResult> {
  const totalStart = performance.now();
  const steps: StepResult[] = [];

  const servicesResult = await fetchStep("get-services", `${client.url}/api/services`, undefined, true);
  steps.push(servicesResult);

  if (servicesResult.ok) {
    let serviceId = "test";
    const body = servicesResult.body;
    const services = Array.isArray(body) ? body : (body as Record<string, unknown>)?.services;
    if (Array.isArray(services) && services.length > 0) {
      serviceId = (services[0].id ?? services[0].serviceId ?? "test") as string;
    }

    const availResult = await fetchStep("get-availability", `${client.url}/api/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: getTomorrowDate(), serviceId }),
    });
    steps.push(availResult);
  }

  const responseTimeMs = Math.round(performance.now() - totalStart);
  const allPassed = steps.every((s) => s.ok);
  const failedStep = steps.find((s) => !s.ok);

  const error = failedStep
    ? `step "${failedStep.step}" failed: ${failedStep.error ?? `HTTP ${failedStep.statusCode}`}`
    : undefined;

  await saveMetric(client.clientId, responseTimeMs, allPassed, error, steps);

  return {
    clientId: client.clientId,
    checkType: "booking",
    success: allPassed,
    responseTimeMs,
    error,
    metadata: { steps },
  };
}

async function fetchStep(
  step: string,
  url: string,
  init?: RequestInit,
  parseBody = false,
): Promise<StepResult> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const timeMs = Math.round(performance.now() - start);
    let body: unknown;
    if (parseBody && res.ok) {
      try { body = await res.json(); } catch { /* ignore parse errors */ }
    }
    return {
      step,
      ok: res.ok,
      statusCode: res.status,
      timeMs,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      body,
    };
  } catch (err) {
    return {
      step,
      ok: false,
      timeMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function saveMetric(
  clientId: string,
  responseTimeMs: number,
  success: boolean,
  error?: string,
  steps?: StepResult[],
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO metrics (client_id, check_type, response_time_ms, success, error, metadata)
       VALUES ($1, 'booking', $2, $3, $4, $5)`,
      [clientId, responseTimeMs, success, error ?? null, steps ? JSON.stringify({ steps }) : null],
    );
  } catch (dbErr) {
    console.error(`[bookingCheck] failed to save metric for ${clientId}:`, dbErr);
  }
}
