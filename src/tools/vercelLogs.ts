import type Anthropic from "@anthropic-ai/sdk";

const VERCEL_API = "https://api.vercel.com";

export const definition: Anthropic.Messages.Tool = {
  name: "vercelLogs",
  description:
    "Read recent deployment logs from Vercel for a project. Gets the latest production deployment and returns its log events.",
  input_schema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", description: "The Vercel project ID (e.g. prj_XXXX)" },
    },
    required: ["projectId"],
  },
};

export async function execute(input: { projectId: string }): Promise<unknown> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { error: "VERCEL_TOKEN not configured" };

  const headers = { Authorization: `Bearer ${token}` };

  const deploymentsRes = await fetch(
    `${VERCEL_API}/v6/deployments?projectId=${input.projectId}&limit=1&target=production`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );

  if (!deploymentsRes.ok) {
    return { error: `failed to list deployments: HTTP ${deploymentsRes.status}` };
  }

  const { deployments } = (await deploymentsRes.json()) as {
    deployments: Array<{ uid: string; state: string; created: number }>;
  };

  if (deployments.length === 0) {
    return { error: "no production deployments found" };
  }

  const deploymentId = deployments[0].uid;

  const eventsRes = await fetch(
    `${VERCEL_API}/v3/deployments/${deploymentId}/events`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );

  if (!eventsRes.ok) {
    return { error: `failed to get deployment events: HTTP ${eventsRes.status}` };
  }

  const events = await eventsRes.json();

  return {
    deploymentId,
    state: deployments[0].state,
    createdAt: new Date(deployments[0].created).toISOString(),
    events,
  };
}
