import { inviteEmail, signInLinkEmail } from "@pubcommand/core";
export const DEFAULT_EMAIL_FROM = "login@pubcommand.com";

export type MagicLinkDelivery = "sent" | "logged" | "failed";

type MailEnv = {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  NODE_ENV?: string;
  AUTH_DEV_EXPOSE_LINKS?: string;
};

type MailResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export function emailFrom(env: MailEnv = process.env): string {
  const value = env.EMAIL_FROM?.trim() ?? "";
  return value.length > 0 ? value : DEFAULT_EMAIL_FROM;
}

/** "Email me a link" sign-in. Off unless EMAIL_LOGIN_ENABLED=true (invite links still work). */
export function emailLoginEnabled(env: MailEnv = process.env): boolean {
  return (env as Record<string, string | undefined>).EMAIL_LOGIN_ENABLED === "true";
}

export function exposeMagicLinkOnPage(env: MailEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.AUTH_DEV_EXPOSE_LINKS === "true";
}

export function magicLinkUrl(origin: string, token: string): string {
  return `${origin}/api/auth/magic-link/verify?token=${token}`;
}

export async function deliverMagicLink(input: {
  to: string;
  url: string;
  kind: "login" | "invite";
  /** Invites: the organization they are joining, named in the subject and heading. */
  organizationName?: string | null;
  env?: MailEnv;
  fetchImpl?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<MailResponse>;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
}): Promise<MagicLinkDelivery> {
  const env = input.env ?? process.env;
  const log = input.log ?? ((line: string) => console.info(line));
  const errorLog = input.errorLog ?? ((line: string) => console.error(line));
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  if (!apiKey) {
    log(`[magic-link] ${input.url}`);
    return "logged";
  }

  let origin: string | null = null;
  try {
    origin = new URL(input.url).origin;
  } catch {
    origin = null;
  }
  const { subject, ...body } =
    input.kind === "invite" ? inviteEmail({ link: input.url, origin, organizationName: input.organizationName }) : signInLinkEmail({ link: input.url, origin });
  const response = await (input.fetchImpl ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom(env),
      to: [input.to],
      subject,
      html: body.html,
      text: body.text,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    errorLog(`[magic-link] Resend failed (${response.status}) ${detail}`);
    return "failed";
  }
  return "sent";
}
