import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";

export const definition: Anthropic.Messages.Tool = {
  name: "getMetricsHistory",
  description:
    "Retrieve recent monitoring metrics for a client from the database. Returns check results ordered by most recent first.",
  input_schema: {
    type: "object" as const,
    properties: {
      clientId: { type: "string", description: "The client ID to query metrics for" },
      checkType: { type: "string", description: "Optional filter by check type: http, api, firestore, or booking" },
      limit: { type: "number", description: "Number of recent metrics to return (default: 20, max: 100)" },
    },
    required: ["clientId"],
  },
};

export async function execute(input: {
  clientId: string;
  checkType?: string;
  limit?: number;
}): Promise<unknown> {
  const limit = Math.min(input.limit ?? 20, 100);

  const hasType = input.checkType !== undefined;
  const { rows } = await db.query(
    `SELECT client_id, check_type, response_time_ms, status_code, success, error, checked_at
     FROM metrics
     WHERE client_id = $1 ${hasType ? "AND check_type = $3" : ""}
     ORDER BY checked_at DESC
     LIMIT $2`,
    hasType ? [input.clientId, limit, input.checkType] : [input.clientId, limit],
  );

  return rows;
}
