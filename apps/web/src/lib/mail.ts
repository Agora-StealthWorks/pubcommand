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

  const subject = input.kind === "invite" ? "You're invited to PubCommand" : "Your PubCommand sign-in link";
  const intro = input.kind === "invite"
    ? "You have been invited to PubCommand. Open this link to sign in:"
    : "Sign in to PubCommand:";
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
      text: `${intro}\n\n${input.url}\n\nThis link expires soon and can be used once.`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    errorLog(`[magic-link] Resend failed (${response.status}) ${detail}`);
    return "failed";
  }
  return "sent";
}
