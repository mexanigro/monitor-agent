/** Critical env vars that must be present for the service to function at all. */
const CRITICAL_VARS = [
  "DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

/** Vars required for specific features — logged as warnings but don't abort startup. */
const FEATURE_VARS: Record<string, string> = {
  ANTHROPIC_API_KEY: "Claude diagnostic agent will be disabled",
  VERCEL_TOKEN: "Vercel logs and redeploy tools will be unavailable",
  RESEND_API_KEY: "Email notifications will be disabled",
  NOTIFY_EMAIL: "Email notifications will be disabled",
};

export function validateEnv(): void {
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
