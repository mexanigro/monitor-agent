import { createServer } from "node:http";

interface RoundStats {
  completedAt: number;
  durationMs: number;
  clientCount: number;
}

const state = {
  startedAt: Date.now(),
  fast: null as RoundStats | null,
  slow: null as RoundStats | null,
};

const FAST_STALE_MS = 15 * 60_000;
const SLOW_STALE_MS = 45 * 60_000;

export function reportRound(name: "fast" | "slow", durationMs: number, clientCount: number): void {
  state[name] = { completedAt: Date.now(), durationMs, clientCount };
}

function isHealthy(): boolean {
  const now = Date.now();
  const uptime = now - state.startedAt;

  if (uptime < 10 * 60_000) return true;

  if (!state.fast || now - state.fast.completedAt > FAST_STALE_MS) return false;
  if (state.slow && now - state.slow.completedAt > SLOW_STALE_MS) return false;

  return true;
}

export function startHealthServer(port = 8080): void {
  const server = createServer((_req, res) => {
    const healthy = isHealthy();
    const body = JSON.stringify({
      status: healthy ? "healthy" : "unhealthy",
      uptime: Math.round((Date.now() - state.startedAt) / 1000),
      fast: state.fast
        ? { agoSec: Math.round((Date.now() - state.fast.completedAt) / 1000), durationMs: state.fast.durationMs, clients: state.fast.clientCount }
        : null,
      slow: state.slow
        ? { agoSec: Math.round((Date.now() - state.slow.completedAt) / 1000), durationMs: state.slow.durationMs, clients: state.slow.clientCount }
        : null,
    });

    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(body);
  });

  server.listen(port, () => {
    console.log(`[health] listening on :${port}`);
  });
}
