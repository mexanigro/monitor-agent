const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export interface FetchResult {
  response: Response | null;
  responseTimeMs: number;
  statusCode: number | undefined;
  error: string | null;
  attempts: number;
}

export async function fetchWithRetry(
  url: string,
  options: Omit<RequestInit, "signal">,
  tag: string,
  timeoutMs = 10_000,
): Promise<FetchResult> {
  const total = RETRY_DELAYS_MS.length + 1;

  for (let i = 0; i < total; i++) {
    const signal = AbortSignal.timeout(timeoutMs);
    const start = performance.now();

    try {
      const response = await fetch(url, { ...options, signal });
      const responseTimeMs = Math.round(performance.now() - start);
      const statusCode = response.status;

      if (response.ok || i === total - 1) {
        return { response, responseTimeMs, statusCode, error: null, attempts: i + 1 };
      }

      console.log(`[${tag}] attempt ${i + 1}/${total} HTTP ${statusCode} — retry in ${RETRY_DELAYS_MS[i]}ms`);
    } catch (err) {
      const responseTimeMs = Math.round(performance.now() - start);
      const error = err instanceof Error ? err.message : String(err);

      if (i === total - 1) {
        return { response: null, responseTimeMs, statusCode: undefined, error, attempts: i + 1 };
      }

      console.log(`[${tag}] attempt ${i + 1}/${total} error: ${error} — retry in ${RETRY_DELAYS_MS[i]}ms`);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
  }

  return { response: null, responseTimeMs: 0, statusCode: undefined, error: "unreachable", attempts: total };
}
