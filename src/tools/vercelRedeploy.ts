import type Anthropic from "@anthropic-ai/sdk";

const VERCEL_API = "https://api.vercel.com";

export const definition: Anthropic.Messages.Tool = {
  name: "vercelRedeploy",
  description:
    "Trigger a redeployment of the latest production deployment for a Vercel project. Use this only when you have strong evidence that a redeploy will fix the issue (e.g. stale cache, transient build failure).",
  input_schema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", description: "The Vercel project ID (e.g. prj_XXXX)" },
      reason: { type: "string", description: "Brief reason for triggering the redeploy" },
    },
    required: ["projectId", "reason"],
  },
};

export async function execute(input: { projectId: string; reason: string }): Promise<unknown> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) return { error: "VERCEL_API_TOKEN not configured" };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const deploymentsRes = await fetch(
    `${VERCEL_API}/v6/deployments?projectId=${input.projectId}&limit=1&target=production`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );

  if (!deploymentsRes.ok) {
    return { error: `failed to list deployments: HTTP ${deploymentsRes.status}` };
  }

  const { deployments } = (await deploymentsRes.json()) as {
    deployments: Array<{ uid: string; name: string }>;
  };

  if (deployments.length === 0) {
    return { error: "no production deployments found to redeploy" };
  }

  const latest = deployments[0];

  const redeployRes = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: latest.name,
      deploymentId: latest.uid,
      target: "production",
      meta: { redeployReason: input.reason, triggeredBy: "monitor-agent" },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!redeployRes.ok) {
    const body = await redeployRes.text();
    return { error: `redeploy failed: HTTP ${redeployRes.status} — ${body}` };
  }

  const result = (await redeployRes.json()) as { id: string; url: string; readyState: string };

  return {
    success: true,
    newDeploymentId: result.id,
    url: result.url,
    readyState: result.readyState,
    reason: input.reason,
  };
}
