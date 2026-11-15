import { can } from "@pubcommand/core";
import { rawPrisma, tenantDb, appendOrgAudit } from "@pubcommand/db";
import { Button } from "@pubcommand/ui";
import { notFound, redirect } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { assignOrgPlan, buildPlansSettingsScreen, createModuleAddOn, createPlan, createSeat, stripeEnvStatus } from "../../../../../../../../modules/billing/index";

async function loadBilling(organizationId: string, includeCatalog: boolean) {
  const db = tenantDb(organizationId);
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: { plan: { include: { modules: true } }, modules: true },
  });
  if (!organization) return null;
  const memberships = await db.membership.findMany({
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  const plans = includeCatalog
    ? await rawPrisma().plan.findMany({ include: { modules: true }, orderBy: { seatLimit: "asc" } })
    : [organization.plan];
  const catalog = plans.map((plan) =>
    createPlan({
      id: plan.id,
      key: plan.key,
      name: plan.name,
      seatLimit: plan.seatLimit,
      monthlyPriceCents: plan.monthlyPriceCents,
      moduleIds: plan.modules.map((row) => row.moduleId),
    }),
  );
  const seats = memberships.map((membership) =>
    createSeat({
      id: membership.id,
      organizationId,
      userId: membership.userId,
      status: membership.status === "INVITED" ? "invited" : membership.status === "DISABLED" ? "released" : "assigned",
    }),
  );
  const included = new Set(organization.plan.modules.map((row) => row.moduleId));
  const addOns = organization.modules
    .filter((row) => row.enabled && !included.has(row.moduleId))
    .map((row) =>
      createModuleAddOn({
        id: `${organizationId}:${row.moduleId}`,
        organizationId,
        moduleId: row.moduleId,
        monthlyPriceCents: 0,
        active: true,
      }),
    );
  const holders = new Map(memberships.map((membership) => [membership.id, membership.user.email]));
  return {
    catalog,
    holders,
    assignment: {
      organizationId,
      planId: organization.planId,
      seatLimit: organization.seatLimit,
      seats,
      addOns,
    },
  };
}

async function assignBillingPlan(formData: FormData) {
  "use server";
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/billing?error=Choose an organization.");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind !== "ok") redirect("/billing?error=You do not have access to that organization.");
  const allowed = ctx.subject.entitledModuleIds.includes("billing") && can(ctx.subject, "billing.manage", ctx.scope);
  if (!allowed) redirect("/billing?error=You do not have permission.");
  const loaded = await loadBilling(ctx.resolved.id, true);
  if (!loaded) redirect("/billing?error=Organization not found.");
  const result = assignOrgPlan({
    organizationId: ctx.resolved.id,
    planId: String(formData.get("planId") ?? ""),
    catalog: loaded.catalog,
    seats: loaded.assignment.seats,
    addOns: loaded.assignment.addOns,
  });
  if (!result.ok) redirect(`/billing?error=${encodeURIComponent(result.message)}`);
  await tenantDb(ctx.resolved.id).organization.updateMany({
    where: { id: ctx.resolved.id },
    data: { planId: result.assignment.planId, seatLimit: result.assignment.seatLimit },
  });
  await appendOrgAudit(ctx.resolved.id, {
    actorId: ctx.effectiveUserId,
    action: "billing.plan.changed",
    targetType: "plan",
    targetId: result.assignment.planId,
    metadata: { seatLimit: result.assignment.seatLimit },
  });
  redirect("/billing?notice=Plan updated.");
}

export default async function BillingRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!ctx.subject.entitledModuleIds.includes("billing")) {
    return (
      <div>
        <PageHeader title="Billing" description="This module is not included for the organization." />
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          Ask an admin to enable it if the plan allows it.
        </p>
      </div>
    );
  }
  if (!can(ctx.subject, "billing.read", ctx.scope)) return <Denied />;

  const canManage = can(ctx.subject, "billing.manage", ctx.scope);
  const loaded = await loadBilling(ctx.resolved.id, canManage);
  if (!loaded) notFound();
  const screen = buildPlansSettingsScreen({
    canRead: true,
    canManage,
    catalog: loaded.catalog,
    assignment: loaded.assignment,
    stripe: stripeEnvStatus(process.env),
  });

  return (
    <div>
      <PageHeader title={screen.title} description={screen.description} />
      <Flash error={query.error} notice={query.notice} />
      {screen.current ? (
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="text-lg font-semibold text-ink">{screen.current.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {screen.current.price} · {screen.current.seatsUsed} of {screen.current.seatLimit} seats
          </p>
          <p className="mt-2 text-sm text-ink">
            <span className="pc-break">{screen.current.modules.length > 0 ? screen.current.modules.join(", ") : "No modules on this plan."}</span>
          </p>
        </section>
      ) : (
        <p className="rounded-lg border border-line bg-white p-5 text-sm text-muted">No plan assigned.</p>
      )}
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Seats</h2>
        {screen.seats.length === 0 ? (
          <p className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">No seats yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {screen.seats.map((seat) => (
              <li key={seat.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="pc-break min-w-0 font-medium text-ink">{loaded.holders.get(seat.id) ?? seat.holder}</span>
                <span className="text-muted">{seat.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Module add-ons</h2>
        {screen.addOns.length === 0 ? (
          <p className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">No module add-ons.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {screen.addOns.map((addOn) => (
              <li key={addOn.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="pc-break min-w-0 font-medium text-ink">{addOn.moduleId}</span>
                <span className="text-muted">{addOn.active ? addOn.price : "Inactive"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {screen.canManage && screen.choices.length > 0 ? (
        <form action={assignBillingPlan} className="pc-form-row mt-6 items-stretch rounded-lg border border-line bg-white p-4 sm:items-end sm:p-5">
          <label className="min-w-0 text-sm" htmlFor="billing-plan">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Plan</span>
            <select
              id="billing-plan"
              name="planId"
              defaultValue={screen.current?.planId ?? screen.choices[0]?.planId}
              className="pc-control w-full"
            >
              {screen.choices.map((choice) => (
                <option key={choice.planId} value={choice.planId}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" className="w-full sm:w-auto">Assign plan</Button>
        </form>
      ) : null}
      <p className="mt-6 text-sm text-muted">{screen.stripe.detail}</p>
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Not in this slice</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {screen.upcoming.map((todo) => (
            <li key={todo.id}>{todo.summary}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
