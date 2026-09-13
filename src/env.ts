/** Critical env vars that must be present for the service to function at all. */
const CRITICAL_VARS = [
  "DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

/** Vars required for specific features — logged as warnings but don't abort startup. */
const FEATURE_VARS: Record<string, string> = {
  RESEND_API_KEY: "Email notifications will be disabled",
  NOTIFY_EMAIL: "Email notifications will be disabled",
};

export function validateEnv(): void {
  // P-04 D-P4-4: el agente IA está apagado salvo MONITOR_AGENT_ENABLED=true; sólo entonces importan sus claves.
  if (process.env.MONITOR_AGENT_ENABLED === "true") {
    for (const v of ["ANTHROPIC_API_KEY", "VERCEL_TOKEN"]) {
      if (!process.env[v]?.trim()) console.warn(`[env] WARNING — ${v} not set: Claude agent / Vercel tools degraded`);
    }
  } else {
    console.log("[env] Claude agent OFF (MONITOR_AGENT_ENABLED !== \"true\") — incidents are logged and emailed without AI");
  }
  const missing = CRITICAL_VARS.filter((v) => !process.env[v]?.trim());
  if (missing.length > 0) {
    console.error(
      `[env] FATAL — missing critical env vars: ${missing.join(", ")} — exiting`
    );
    process.exit(1);
  }

  for (const [v, consequence] of Object.entries(FEATURE_VARS)) {
    if (!process.env[v]?.trim()) {
      console.warn(`[env] WARNING — ${v} not set: ${consequence}`);
    }
  }
}
