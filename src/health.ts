import { createServer } from "node:http";
import { db } from "./db/client.js";

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

async function getActiveIncidents(): Promise<number> {
  try {
    const { rows } = await db.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM incidents WHERE resolved = FALSE",
    );
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

export function startHealthServer(port = 8080): void {
  const server = createServer(async (_req, res) => {
    try {
      const now = Date.now();
      const healthy = isHealthy();
      const activeIncidents = await getActiveIncidents();

      const lastCheckTs = Math.max(
        state.fast?.completedAt ?? 0,
        state.slow?.completedAt ?? 0,
      );

      const body = JSON.stringify({
        status: healthy ? "healthy" : "unhealthy",
        uptime: Math.round((now - state.startedAt) / 1000),
        monitoredClients: state.fast?.clientCount ?? state.slow?.clientCount ?? 0,
        activeIncidents,
        lastCheck: lastCheckTs > 0 ? new Date(lastCheckTs).toISOString() : null,
        lastCheckAgoSec: lastCheckTs > 0 ? Math.round((now - lastCheckTs) / 1000) : null,
        fast: state.fast
          ? { agoSec: Math.round((now - state.fast.completedAt) / 1000), durationMs: state.fast.durationMs, clients: state.fast.clientCount }
          : null,
        slow: state.slow
          ? { agoSec: Math.round((now - state.slow.completedAt) / 1000), durationMs: state.slow.durationMs, clients: state.slow.clientCount }
          : null,
      });

      res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      res.end(body);
    } catch (err) {
      console.error("[health] handler error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error" }));
    }
  });

  server.listen(port, () => {
    console.log(`[health] listening on :${port}`);
  });
}
