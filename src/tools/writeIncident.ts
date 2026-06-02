import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";
import { sendIncidentEmail } from "../notifications.js";

export const definition: Anthropic.Messages.Tool = {
  name: "writeIncident",
  description:
    "Write an incident report to the database. Always call this at the end of your analysis to record the diagnosis and any actions taken.",
  input_schema: {
    type: "object" as const,
    properties: {
      clientId: { type: "string", description: "The affected client ID" },
      severity: { type: "string", enum: ["warning", "critical"], description: "Incident severity" },
      checkType: { type: "string", description: "The check type that detected the issue" },
      description: { type: "string", description: "What went wrong" },
      claudeDiagnosis: { type: "string", description: "Your analysis of the root cause" },
      actionTaken: { type: "string", description: "What action was taken (e.g. redeployed, or requires manual intervention)" },
    },
    required: ["clientId", "severity", "checkType", "description", "claudeDiagnosis", "actionTaken"],
  },
};

export async function execute(input: {
  clientId: string;
  severity: string;
  checkType: string;
  description: string;
  claudeDiagnosis: string;
  actionTaken: string;
}): Promise<unknown> {
  const { rows } = await db.query(
    `INSERT INTO incidents (client_id, severity, check_type, description, claude_diagnosis, action_taken)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [input.clientId, input.severity, input.checkType, input.description, input.claudeDiagnosis, input.actionTaken],
  );

  const incident = rows[0] as { id: number; created_at: Date };
  console.log(`[incident] #${incident.id} created: ${input.severity} — ${input.clientId}/${input.checkType}`);

  const { rows: recentNotifs } = await db.query(
    `SELECT notification_sent_at FROM incidents
     WHERE client_id = $1 AND check_type = $2 AND resolved = FALSE
     AND notification_sent_at > NOW() - INTERVAL '1 hour'
     LIMIT 1`,
    [input.clientId, input.checkType],
  );

  if (recentNotifs.length > 0) {
    console.log(`[writeIncident] skipping email — recent notification exists for ${input.clientId}/${input.checkType}`);
  } else {
    try {
      await sendIncidentEmail(
        input.clientId,
        input.severity as "warning" | "critical",
        input.checkType as import("../types.js").CheckType,
        input.description,
        input.claudeDiagnosis,
        input.actionTaken,
      );
      await db.query(
        `UPDATE incidents SET notification_sent_at = NOW() WHERE id = $1`,
        [incident.id],
      );
    } catch (err) {
      console.error(`[writeIncident] email notification failed for incident #${incident.id}:`, err);
    }
  }

  return { incidentId: incident.id, createdAt: incident.created_at };
}
