import type { CheckType, Severity } from "./types.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "liam.arzac@gmail.com";
const FROM_EMAIL = process.env.FROM_EMAIL || "Nichos Monitor <onboarding@resend.dev>";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MAX_EMAILS_PER_HOUR = 5;
const DEDUP_WINDOW_MS = 60 * 60_000;

const sentTimestamps: number[] = [];
const recentlySent = new Map<string, number>();

function isRateLimited(): boolean {
  const now = Date.now();
  while (sentTimestamps.length > 0 && now - sentTimestamps[0] > DEDUP_WINDOW_MS) {
    sentTimestamps.shift();
  }
  return sentTimestamps.length >= MAX_EMAILS_PER_HOUR;
}

function isDuplicate(dedupKey: string): boolean {
  const now = Date.now();
  for (const [key, ts] of recentlySent) {
    if (now - ts >= DEDUP_WINDOW_MS) recentlySent.delete(key);
  }
  const lastSent = recentlySent.get(dedupKey);
  if (lastSent && now - lastSent < DEDUP_WINDOW_MS) return true;
  return false;
}

async function sendEmail(subject: string, html: string, dedupKey?: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn("[notify] RESEND_API_KEY not set — skipping email");
    return;
  }

  if (dedupKey && isDuplicate(dedupKey)) {
    console.log(`[notify] skipping duplicate email for ${dedupKey}`);
    return;
  }

  if (isRateLimited()) {
    console.warn(`[notify] rate limited (${MAX_EMAILS_PER_HOUR}/hour) — skipping: ${subject}`);
    return;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [NOTIFY_EMAIL],
          subject,
          html,
        }),
      });

      if (res.ok) {
        sentTimestamps.push(Date.now());
        if (dedupKey) recentlySent.set(dedupKey, Date.now());
        console.log(`[notify] email sent: ${subject}`);
        return;
      }

      const body = await res.text();
      console.error(`[notify] Resend API error ${res.status} (attempt ${attempt + 1}/2): ${body}`);
    } catch (err) {
      console.error(`[notify] send failed (attempt ${attempt + 1}/2):`, err);
    }

    if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
  }
}

export async function sendIncidentEmail(
  clientId: string,
  severity: Severity,
  checkType: CheckType,
  description: string,
  diagnosis: string,
  actionTaken: string,
): Promise<void> {
  const action = actionTaken.toLowerCase();
  const autoResolved = action.includes("redeployed")
    || action.includes("redeploy triggered")
    || action.includes("resolved automatically")
    || action.includes("no action needed");

  if (autoResolved) {
    console.log(`[notify] skipping email — Claude auto-resolved: ${actionTaken}`);
    return;
  }

  const isCritical = severity === "critical";
  const emoji = isCritical ? "🚨" : "⚠️";
  const color = isCritical ? "#dc2626" : "#f59e0b";
  const label = isCritical ? "CRITICAL" : "WARNING";

  const subject = `${emoji} ${label}: ${clientId} — ${checkType}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${color}; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">${emoji} ${label} — ${escapeHtml(checkType)}</h2>
        <p style="margin: 4px 0 0; opacity: 0.9;">${escapeHtml(clientId)}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <h3 style="margin: 0 0 8px; color: #374151;">Problema</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${escapeHtml(description)}</p>

        <h3 style="margin: 0 0 8px; color: #374151;">Diagnóstico (Claude)</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${escapeHtml(diagnosis)}</p>

        <h3 style="margin: 0 0 8px; color: #374151;">Acción tomada</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${escapeHtml(actionTaken)}</p>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
        <p style="margin: 0; font-size: 12px; color: #9ca3af;">Monitor Agent — Nichos Hub</p>
      </div>
    </div>
  `;

  await sendEmail(subject, html, `${clientId}:${checkType}`);
}

export async function sendResolvedEmail(
  clientId: string,
  checkType: CheckType,
  originalDescription: string,
  incidentCreatedAt: Date,
): Promise<void> {
  const duration = timeSince(incidentCreatedAt);

  const subject = `✅ RESUELTO: ${clientId} — ${checkType}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #16a34a; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0;">✅ Incidente resuelto</h2>
        <p style="margin: 4px 0 0; opacity: 0.9;">${escapeHtml(clientId)} — ${escapeHtml(checkType)}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <h3 style="margin: 0 0 8px; color: #374151;">Problema original</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${escapeHtml(originalDescription)}</p>

        <h3 style="margin: 0 0 8px; color: #374151;">Duración</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${duration}</p>

        <p style="margin: 0 0 16px; color: #6b7280;">3 checks consecutivos saludables confirmaron la recuperación.</p>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
        <p style="margin: 0; font-size: 12px; color: #9ca3af;">Monitor Agent — Nichos Hub</p>
      </div>
    </div>
  `;

  await sendEmail(subject, html);
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
