import type { CheckType, Severity } from "./types.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "liam.arzac@gmail.com";
const FROM_EMAIL = process.env.FROM_EMAIL || "Nichos Monitor <onboarding@resend.dev>";

async function sendEmail(subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn("[notify] RESEND_API_KEY not set — skipping email");
    return;
  }

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

    if (!res.ok) {
      const body = await res.text();
      console.error(`[notify] Resend API error ${res.status}: ${body}`);
    } else {
      console.log(`[notify] email sent: ${subject}`);
    }
  } catch (err) {
    console.error("[notify] failed to send email:", err);
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
  const needsManual = actionTaken.toLowerCase().includes("manual intervention")
    || actionTaken.toLowerCase().includes("requires manual")
    || actionTaken.toLowerCase().includes("could not resolve");

  if (!needsManual) {
    console.log(`[notify] skipping email — Claude handled it: ${actionTaken}`);
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
        <h2 style="margin: 0;">${emoji} ${label} — ${checkType}</h2>
        <p style="margin: 4px 0 0; opacity: 0.9;">${clientId}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <h3 style="margin: 0 0 8px; color: #374151;">Problema</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${description}</p>

        <h3 style="margin: 0 0 8px; color: #374151;">Diagnóstico (Claude)</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${diagnosis}</p>

        <h3 style="margin: 0 0 8px; color: #374151;">Acción tomada</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${actionTaken}</p>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
        <p style="margin: 0; font-size: 12px; color: #9ca3af;">Monitor Agent — Nichos Hub</p>
      </div>
    </div>
  `;

  await sendEmail(subject, html);
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
        <p style="margin: 4px 0 0; opacity: 0.9;">${clientId} — ${checkType}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <h3 style="margin: 0 0 8px; color: #374151;">Problema original</h3>
        <p style="margin: 0 0 16px; color: #6b7280;">${originalDescription}</p>

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
