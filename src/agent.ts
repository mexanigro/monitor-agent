import Anthropic from "@anthropic-ai/sdk";
import type { Anomaly, BaselineRow, MetricRow, MonitoredClient } from "./types.js";
import { definition as getMetricsHistoryDef, execute as getMetricsHistoryExec } from "./tools/getMetricsHistory.js";
import { definition as vercelLogsDef, execute as vercelLogsExec } from "./tools/vercelLogs.js";
import { definition as vercelRedeployDef, execute as vercelRedeployExec } from "./tools/vercelRedeploy.js";
import { definition as writeIncidentDef, execute as writeIncidentExec } from "./tools/writeIncident.js";

const MAX_TURNS = 5;
const MAX_CONCURRENT_AGENTS = 3;
const COOLDOWN_MS = 10 * 60_000;

let activeAgents = 0;
const lastAgentRun = new Map<string, number>();

const anthropic = new Anthropic();

const tools: Anthropic.Messages.Tool[] = [
  getMetricsHistoryDef,
  vercelLogsDef,
  vercelRedeployDef,
  { ...writeIncidentDef, cache_control: { type: "ephemeral" } } as Anthropic.Messages.Tool,
];

const executors: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
  getMetricsHistory: getMetricsHistoryExec as (input: Record<string, unknown>) => Promise<unknown>,
  vercelLogs: vercelLogsExec as (input: Record<string, unknown>) => Promise<unknown>,
  vercelRedeploy: vercelRedeployExec as (input: Record<string, unknown>) => Promise<unknown>,
  writeIncident: writeIncidentExec as (input: Record<string, unknown>) => Promise<unknown>,
};

const SYSTEM_PROMPT = `You are a monitoring agent for a multi-tenant SaaS platform deployed on Vercel.
An automated analyzer has detected an anomaly for one of our clients.

Your job:
1. Review the anomaly details and recent metrics provided below.
2. Use getMetricsHistory to get more context if needed.
3. Check vercelLogs if the issue might be deployment-related.
4. Decide whether to trigger a vercelRedeploy (only if the issue looks deployment-related, like a stale build or transient failure) or just log the incident.
5. ALWAYS call writeIncident at the end to record your diagnosis and any actions taken.

Be concise and decisive. You have a maximum of ${MAX_TURNS} tool calls.
If you cannot resolve the issue, record it as "requires manual intervention" in the incident.`;

function buildUserMessage(client: MonitoredClient, anomaly: Anomaly, metrics: MetricRow[], baseline: BaselineRow): string {
  return [
    `## Anomaly Detected`,
    `- Client: ${anomaly.clientId}`,
    `- Name: ${client.name}`,
    `- URL: ${client.url}`,
    `- Vercel Project ID: ${client.vercelProjectId}`,
    `- Check type: ${anomaly.checkType}`,
    `- Severity: ${anomaly.severity}`,
    `- Description: ${anomaly.description}`,
    ``,
    `## Baseline`,
    `- Avg response time: ${baseline.avg_response_time_ms}ms`,
    `- P95 response time: ${baseline.p95_response_time_ms}ms`,
    `- Success rate: ${baseline.success_rate}%`,
    ``,
    `## Recent Metrics (last ${metrics.length})`,
    JSON.stringify(
      metrics.map((m) => ({
        checkType: m.check_type,
        success: m.success,
        responseTimeMs: m.response_time_ms,
        statusCode: m.status_code,
        error: m.error,
        checkedAt: m.checked_at,
      })),
      null,
      2,
    ),
  ].join("\n");
}

export async function runAgent(client: MonitoredClient, anomaly: Anomaly, metrics: MetricRow[], baseline: BaselineRow): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[agent] ANTHROPIC_API_KEY not configured — skipping agent");
    return;
  }

  const cooldownKey = `${anomaly.clientId}:${anomaly.checkType}`;
  const lastRun = lastAgentRun.get(cooldownKey) ?? 0;
  if (Date.now() - lastRun < COOLDOWN_MS) {
    console.log(`[agent] skipping ${anomaly.clientId} — cooldown active (last run ${Math.round((Date.now() - lastRun) / 1000)}s ago)`);
    return;
  }

  if (activeAgents >= MAX_CONCURRENT_AGENTS) {
    console.warn(`[agent] skipping ${anomaly.clientId} — ${activeAgents}/${MAX_CONCURRENT_AGENTS} agents already running`);
    return;
  }

  activeAgents++;
  lastAgentRun.set(cooldownKey, Date.now());

  try {
    await runAgentInner(client, anomaly, metrics, baseline);
  } finally {
    activeAgents--;
  }
}

async function runAgentInner(client: MonitoredClient, anomaly: Anomaly, metrics: MetricRow[], baseline: BaselineRow): Promise<void> {
  console.log(`[agent] starting diagnosis for ${anomaly.clientId}/${anomaly.checkType} (${anomaly.severity})`);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: buildUserMessage(client, anomaly, metrics, baseline) },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response: Anthropic.Messages.Message | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools,
          messages,
        });
        break;
      } catch (err) {
        if (attempt === 1) throw err;
        console.warn(`[agent] API call failed (attempt ${attempt + 1}/2), retrying in 5s:`, err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    if (!response) throw new Error("unreachable: API call failed without throwing");

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      console.log(`[agent] finished diagnosis in ${turn + 1} turn(s)`);
      return;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      console.log("[agent] no more tool calls — done");
      return;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      const executor = executors[block.name];
      if (!executor) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: `unknown tool: ${block.name}` }),
          is_error: true,
        });
        continue;
      }

      try {
        const result = await executor(block.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  console.log(`[agent] reached max turns (${MAX_TURNS}) — writing fallback incident`);
  await writeIncidentExec({
    clientId: anomaly.clientId,
    severity: anomaly.severity,
    checkType: anomaly.checkType,
    description: anomaly.description,
    claudeDiagnosis: "Agent reached maximum turns without resolution",
    actionTaken: "requires manual intervention",
  });
}
