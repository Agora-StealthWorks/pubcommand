import { emailFrom } from "./mail";

export type EmailResult = { status: "sent"; id: string | null } | { status: "logged" } | { status: "failed"; reason: string };

/**
 * Sends one email through Resend (RESEND_API_KEY). Without a key nothing is sent
 * and the result is "logged" (subject and recipient only, never the body), so
 * callers can show "email is not set up". Never throws.
 *
 * Callers must only email addresses the user expects (reviewers they named,
 * their own team, subscribers who opted in). Never send on someone's behalf
 * to an address they did not choose.
 */
export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
  attachments?: { filename: string; content: Buffer | Uint8Array }[];
  fetchImpl?: typeof fetch;
}): Promise<EmailResult> {
  const recipients = (Array.isArray(input.to) ? input.to : [input.to]).map((value) => value.trim()).filter(Boolean);
  if (recipients.length === 0) return { status: "failed", reason: "No recipient." };
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  if (!apiKey) {
    console.info(`[email] not sent (RESEND_API_KEY unset): "${input.subject}" to ${recipients.length} recipient(s)`);
    return { status: "logged" };
  }
  try {
    const response = await (input.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: input.from ?? emailFrom(),
        to: recipients,
        subject: input.subject.slice(0, 250),
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length
          ? { attachments: input.attachments.map((file) => ({ filename: file.filename, content: Buffer.from(file.content).toString("base64") })) }
          : {}),
      }),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      console.error(`[email] Resend failed (${response.status}) ${body}`);
      return { status: "failed", reason: `The email service returned ${response.status}.` };
    }
    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", id: data.id ?? null };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Email failed." };
  }
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** Escapes text for use inside an email's HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
