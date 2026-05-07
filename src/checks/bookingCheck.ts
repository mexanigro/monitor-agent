import { db } from "../db/client.js";
import type { CheckResult, MonitoredClient } from "../types.js";

const TIMEOUT_MS = 15_000;

interface StepResult {
  step: string;
  ok: boolean;
  statusCode?: number;
  timeMs: number;
  error?: string;
}

export async function bookingCheck(client: MonitoredClient): Promise<CheckResult> {
  const totalStart = performance.now();
  const steps: StepResult[] = [];

  const stepsToRun: Array<{ step: string; run: () => Promise<StepResult> }> = [
    { step: "get-services", run: () => fetchStep("get-services", `${client.url}/api/services`) },
    { step: "get-availability", run: () => fetchStep("get-availability", `${client.url}/api/availability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: getTomorrowDate(), serviceId: "test", _monitor_test: true }),
    })},
    { step: "validate-booking", run: () => fetchStep("validate-booking", `${client.url}/api/bookings/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: "test",
        date: getTomorrowDate(),
        time: "10:00",
        clientName: "Monitor Agent",
        clientPhone: "+0000000000",
        _monitor_test: true,
      }),
    })},
  ];

  for (const { run } of stepsToRun) {
    const result = await run();
    steps.push(result);

    if (!result.ok) break;
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
): Promise<StepResult> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const timeMs = Math.round(performance.now() - start);
    return {
      step,
      ok: res.ok,
      statusCode: res.status,
      timeMs,
      error: res.ok ? undefined : `HTTP ${res.status}`,
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
