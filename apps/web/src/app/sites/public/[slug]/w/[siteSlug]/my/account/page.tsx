import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tenantDb } from "@pubcommand/db";
import { membersPage } from "@/features/websites/members-area";
import { MembersShell, fmtDate } from "@/features/websites/site-view";
import { PASSWORD_FORM_ERRORS, PASSWORD_MIN, entitlementActive } from "../../../../../../../../../../../modules/websites/content";

type Params = Promise<{ slug: string; siteSlug: string }>;

export const metadata: Metadata = { title: { absolute: "Account" }, robots: { index: false } };

export default async function MemberAccount({ params, searchParams }: { params: Params; searchParams: Promise<{ error?: string; password?: string }> }) {
  const { slug, siteSlug } = await params;
  const query = await searchParams;
  const area = await membersPage(slug, siteSlug, "/my/account");
  if (!area) notFound();
  const { loaded, member } = area;
  const { base, timeZone, now, site } = loaded;
  const db = tenantDb(loaded.organizationId);
  const [products, signups] = await Promise.all([
    db.webProduct.findMany({ where: { siteId: site.id }, select: { id: true, name: true } }),
    db.webSignup.findMany({ where: { siteId: site.id, email: member.email, status: "subscribed" }, select: { publicationId: true } }),
  ]);
  return (
    <MembersShell loaded={loaded} member={member} active="account">
      <section className="welcome dark" style={{ paddingBottom: 30 }}>
        <div className="wrap">
          <span className="label gold">Account</span>
          <h1>{member.name || member.email}</h1>
          <p>{member.email} · member since {fmtDate(member.createdAt, timeZone)}</p>
        </div>
      </section>
      <div className="wrap grid2" style={{ padding: "30px 16px 60px" }}>
        <div className="panel">
          <div className="ph2"><h2>Subscriptions</h2></div>
          {member.entitlements.map((entitlement) => {
            const on = entitlementActive(entitlement, now);
            return (
              <div key={entitlement.id} className="iss">
                <span className="d">{on ? (entitlement.status === "past_due" ? "Payment due" : "Active") : "Ended"}</span>
                <h4>{products.find((product) => product.id === entitlement.productId)?.name ?? "Subscription"}</h4>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{entitlement.endsAt ? `to ${fmtDate(entitlement.endsAt, timeZone)}` : "no end date"}</span>
              </div>
            );
          })}
          {member.entitlements.length === 0 ? <p style={{ color: "var(--muted)" }}>You have no active subscriptions.</p> : null}
          <h3 className="osw" style={{ fontSize: 16, color: "var(--navy)", margin: "24px 0 8px" }}>Free newsletters</h3>
          <p style={{ color: "var(--muted)", margin: 0 }}>
            {signups.map((row) => loaded.publications.find((pub) => pub.id === row.publicationId)?.name).filter(Boolean).join(", ") || "None yet."}{" "}
            <a href={`${base}/newsletters`} style={{ color: "var(--dgold)", fontWeight: 600 }}>Add more</a>
          </p>
        </div>
        <div className="panel" id="password">
          <div className="ph2"><h2>Change password</h2></div>
          {query.password === "changed" || query.password === "set" ? <p className="note-ok">Your password is saved. Other devices were signed out.</p> : null}
          {query.error && PASSWORD_FORM_ERRORS[query.error] ? <p className="note-err">{PASSWORD_FORM_ERRORS[query.error]}</p> : null}
          <form method="post" action={`${base}/my/account/password`} className="pwform">
            <input type="text" name="username" value={member.email} autoComplete="username" readOnly hidden />
            <label htmlFor="current-password">Current password</label>
            <input id="current-password" className="field" type="password" name="currentPassword" required maxLength={200} autoComplete="current-password" />
            <label htmlFor="new-password">New password</label>
            <input id="new-password" className="field" type="password" name="password" required minLength={PASSWORD_MIN} maxLength={200} autoComplete="new-password" />
            <label htmlFor="confirm-password">Type it again</label>
            <input id="confirm-password" className="field" type="password" name="confirm" required minLength={PASSWORD_MIN} maxLength={200} autoComplete="new-password" />
            <button className="btn btn-navy">Change password</button>
          </form>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            Forgot it?{" "}
            <a href={`${base}/sign-in?forgot=1`} style={{ color: "var(--dgold)", fontWeight: 600 }}>
              Email me a link to set a new one
            </a>
          </p>
        </div>
        <div className="panel">
          <div className="ph2"><h2>Help</h2></div>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>Questions about your subscription or billing?{site.supportEmail ? <> Email <a href={`mailto:${site.supportEmail}`} style={{ color: "var(--dgold)", fontWeight: 600 }}>{site.supportEmail}</a>.</> : " Contact customer service."}</p>
          <form method="post" action={`${base}/sign-out`}>
            <button className="btn btn-line">Sign out</button>
          </form>
        </div>
      </div>
    </MembersShell>
  );
}
