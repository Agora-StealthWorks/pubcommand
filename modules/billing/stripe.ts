export const STRIPE_ENV_NAMES = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
] as const;

export type StripeEnvName = (typeof STRIPE_ENV_NAMES)[number];

export type StripeEnv = {
  STRIPE_SECRET_KEY?: string | undefined;
  STRIPE_WEBHOOK_SECRET?: string | undefined;
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string | undefined;
  [key: string]: string | undefined;
};

export type StripeEnvStatus = {
  secretKey: boolean;
  webhookSecret: boolean;
  publishableKey: boolean;
};

export type StripeResult =
  | { ok: false; skipped: true; reason: "missing_secret" }
  | { ok: true; skipped: false; id: string }
  | { ok: false; skipped: false; status: number; message: string };

export type StripeClient = {
  readonly enabled: boolean;
  createCustomer(input: { organizationId: string; email?: string }): Promise<StripeResult>;
  createCheckoutSession(input: {
    organizationId: string;
    planKey: string;
    planName: string;
    monthlyPriceCents: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<StripeResult>;
};

type StripeRequest = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  redirect: "manual";
};

export type StripeFetch = (input: string, init: StripeRequest) => Promise<Response>;

const skipped: StripeResult = { ok: false, skipped: true, reason: "missing_secret" };

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function stripeEnvStatus(env: StripeEnv): StripeEnvStatus {
  return {
    secretKey: present(env.STRIPE_SECRET_KEY),
    webhookSecret: present(env.STRIPE_WEBHOOK_SECRET),
    publishableKey: present(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  };
}

function localFailure(message: string): StripeResult {
  return { ok: false, skipped: false, status: 0, message };
}

function readId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("id" in payload)) return null;
  const id = payload.id;
  return typeof id === "string" && id ? id : null;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
      return error.message.slice(0, 300);
    }
  }
  return `Stripe returned ${status}`;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function createLiveClient(secret: string, fetchImpl: StripeFetch): StripeClient {
  async function post(path: string, body: URLSearchParams): Promise<StripeResult> {
    const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, skipped: false, status: response.status, message: "Stripe redirected the request" };
    }
    const payload = await readPayload(response);
    if (!response.ok) {
      return { ok: false, skipped: false, status: response.status, message: errorMessage(payload, response.status) };
    }
    const id = readId(payload);
    if (!id) {
      return { ok: false, skipped: false, status: response.status, message: "Stripe response did not include an id" };
    }
    return { ok: true, skipped: false, id };
  }

  return {
    enabled: true,
    async createCustomer(input) {
      const organizationId = input.organizationId.trim();
      if (!organizationId) return localFailure("Organization is required");
      const body = new URLSearchParams();
      body.set("metadata[organization_id]", organizationId);
      const email = input.email?.trim();
      if (email) body.set("email", email);
      return post("customers", body);
    },
    async createCheckoutSession(input) {
      const organizationId = input.organizationId.trim();
      const planKey = input.planKey.trim();
      const planName = input.planName.trim();
      if (!organizationId || !planKey || !planName) return localFailure("Plan and organization are required");
      if (!Number.isInteger(input.monthlyPriceCents) || input.monthlyPriceCents < 0) {
        return localFailure("monthlyPriceCents must be a non-negative integer");
      }
      if (!input.successUrl.trim() || !input.cancelUrl.trim()) return localFailure("Checkout URLs are required");
      const body = new URLSearchParams();
      body.set("mode", "subscription");
      body.set("success_url", input.successUrl);
      body.set("cancel_url", input.cancelUrl);
      body.set("client_reference_id", organizationId);
      body.set("metadata[organization_id]", organizationId);
      body.set("metadata[plan_key]", planKey);
      body.set("line_items[0][quantity]", "1");
      body.set("line_items[0][price_data][currency]", "usd");
      body.set("line_items[0][price_data][unit_amount]", String(input.monthlyPriceCents));
      body.set("line_items[0][price_data][recurring][interval]", "month");
      body.set("line_items[0][price_data][product_data][name]", planName);
      return post("checkout/sessions", body);
    },
  };
}

const noopClient: StripeClient = {
  enabled: false,
  createCustomer: () => Promise.resolve(skipped),
  createCheckoutSession: () => Promise.resolve(skipped),
};

/**
 * Stripe API wrapper. Without `STRIPE_SECRET_KEY` every call returns `missing_secret`
 * and does not touch the network. The secret stays in this closure and is not copied
 * onto the client object.
 */
export function createStripeClient(env: StripeEnv = process.env, fetchImpl?: StripeFetch): StripeClient {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return noopClient;
  const send = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  return createLiveClient(secret, send);
}
