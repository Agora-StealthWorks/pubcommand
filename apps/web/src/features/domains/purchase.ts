/**
 * Buying a domain. Purchases are NON-REFUNDABLE, so every attempt is written to
 * `domain_purchases` before anything is charged, and updated with the outcome.
 *
 * Order of steps:
 *   1. ledger.start            (row: STARTED)
 *   2. registrar.checkDomains  real-time registry check; the price must equal
 *                              the one the person confirmed, or we stop
 *   3. payment.charge          PaymentStep — today the Cloudflare account pays
 *                              (`cloudflareAccountPays`). A future Stripe step
 *                              charges the organization's saved card here,
 *                              before the registrar call, and must refund if
 *                              step 4 fails.
 *   4. registrar.registerDomain
 *   5. ledger.finish           (SUCCEEDED / PENDING / FAILED)
 *
 * Pure orchestration: the registrar, payment step and ledger are injected, so
 * tests never buy anything.
 */

import { samePrice } from "../../../../../modules/settings/domains/records";
import type { CloudflareClient, Registration } from "./cloudflare";

export type PaymentCharge = { organizationId: string; actorId: string; domain: string; amount: string; currency: string };
export type PaymentResult = { ok: true; reference: string | null } | { ok: false; reason: string };

export interface PaymentStep {
  /** Shown in the purchase record and the audit log. */
  readonly name: string;
  charge(input: PaymentCharge): Promise<PaymentResult>;
  /** Called when the registrar fails after a successful charge. */
  refund?(input: PaymentCharge & { reference: string | null }): Promise<void>;
}

/** No separate charge: the Cloudflare account's billing method pays the registry. */
export const cloudflareAccountPays: PaymentStep = {
  name: "cloudflare-account",
  async charge() {
    return { ok: true, reference: null };
  },
};

export type LedgerStart = {
  organizationId: string;
  brandId: string | null;
  actorId: string;
  domain: string;
  price: string;
  currency: string;
  sandbox: boolean;
};

export type LedgerFinish = {
  result: "SUCCEEDED" | "PENDING" | "FAILED";
  error?: string | null;
  registrarStatus?: string | null;
  workflowUrl?: string | null;
  paymentReference?: string | null;
  response?: unknown;
};

export interface PurchaseLedger {
  start(input: LedgerStart): Promise<string>;
  finish(id: string, update: LedgerFinish): Promise<void>;
}

export type PurchaseOutcome =
  | { kind: "registered"; purchaseId: string; domain: string }
  | { kind: "pending"; purchaseId: string; domain: string }
  | { kind: "refused"; purchaseId: string; reason: string }
  | { kind: "failed"; purchaseId: string; reason: string };

type Registrar = Pick<CloudflareClient, "checkDomains" | "registerDomain" | "sandbox">;

export async function purchaseDomain(
  input: { organizationId: string; brandId: string | null; actorId: string; domain: string; quotedPrice: string; quotedCurrency: string },
  deps: { registrar: Registrar; payment: PaymentStep; ledger: PurchaseLedger },
): Promise<PurchaseOutcome> {
  const { registrar, payment, ledger } = deps;
  const purchaseId = await ledger.start({
    organizationId: input.organizationId,
    brandId: input.brandId,
    actorId: input.actorId,
    domain: input.domain,
    price: input.quotedPrice,
    currency: input.quotedCurrency,
    sandbox: registrar.sandbox,
  });

  const refuse = async (reason: string, response?: unknown): Promise<PurchaseOutcome> => {
    await ledger.finish(purchaseId, { result: "FAILED", error: reason, response });
    return { kind: "refused", purchaseId, reason };
  };

  let check;
  try {
    [check] = await registrar.checkDomains([input.domain]);
  } catch (error) {
    return refuse(`Could not confirm availability: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (!check || check.name !== input.domain) return refuse("Cloudflare did not return this domain.");
  if (!check.registrable) return refuse(check.reason ? `Not available: ${check.reason}.` : "This domain is no longer available.", check);
  if (check.tier && check.tier !== "standard") return refuse("Premium domains cannot be bought through the Registrar API yet.", check);
  if (!check.pricing) return refuse("Cloudflare did not return a price.", check);
  if (check.pricing.currency !== input.quotedCurrency.toUpperCase() || !samePrice(check.pricing.registrationCost, input.quotedPrice)) {
    return refuse(
      `The price changed to ${check.pricing.registrationCost} ${check.pricing.currency} since you confirmed. Nothing was bought; review the new price and confirm again.`,
      check,
    );
  }

  const charge: PaymentCharge = {
    organizationId: input.organizationId,
    actorId: input.actorId,
    domain: input.domain,
    amount: check.pricing.registrationCost,
    currency: check.pricing.currency,
  };
  const paid = await payment.charge(charge);
  if (!paid.ok) return refuse(`Payment failed: ${paid.reason}`);

  let registration: Registration;
  try {
    registration = await registrar.registerDomain(input.domain);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    if (payment.refund) await payment.refund({ ...charge, reference: paid.reference }).catch(() => undefined);
    await ledger.finish(purchaseId, { result: "FAILED", error: reason, paymentReference: paid.reference });
    return { kind: "failed", purchaseId, reason };
  }

  if (registration.state === "pending") {
    await ledger.finish(purchaseId, {
      result: "PENDING",
      registrarStatus: registration.registrarStatus,
      workflowUrl: registration.workflowUrl,
      paymentReference: paid.reference,
      response: registration.raw,
    });
    return { kind: "pending", purchaseId, domain: registration.domain };
  }
  await ledger.finish(purchaseId, {
    result: "SUCCEEDED",
    registrarStatus: registration.registrarStatus,
    paymentReference: paid.reference,
    response: registration.raw,
  });
  return { kind: "registered", purchaseId, domain: registration.domain };
}
