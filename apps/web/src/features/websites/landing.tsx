import { tenantDb } from "@pubcommand/db";
import type { Publication } from "@/features/pubsetup/read";
import { Archive } from "./archive";
import type { SignedInMember } from "./members";
import type { LoadedSite } from "./public";
import { FormNote, PubBadge } from "./site-view";
import { ownsPublication } from "../../../../../modules/websites/content";

/** Landing page for one publication: free sign-up or how to join, then its archive. */
export async function PublicationLanding({ loaded, member, pub, page, signup, kind }: { loaded: LoadedSite; member: SignedInMember | null; pub: Publication; page: number; signup?: string; kind: "newsletters" | "research" }) {
  const { base } = loaded;
  const free = kind === "newsletters";
  const product = free
    ? null
    : await tenantDb(loaded.organizationId).webProduct.findFirst({ where: { siteId: loaded.site.id, active: true, offerUrl: { not: null }, OR: [{ publicationIds: { has: pub.id } }, { allPublications: true }] }, orderBy: [{ allPublications: "asc" }, { sortOrder: "asc" }] });
  const offer = product?.offerUrl ?? pub.signupUrl ?? null;
  const owns = member ? ownsPublication(member.access, pub.id) : false;
  const path = `${base}/${kind}/${pub.slug}`;
  const header = (
    <section className="mast dark">
      <div className="wrap grid">
        <div>
          <PubBadge loaded={loaded} pub={pub} size="lg" sub={free ? "Free newsletter" : pub.tier ?? undefined} />
          <h1>{pub.tagline || pub.name}</h1>
          <p>{pub.longDescription || pub.description || pub.positioning || ""}</p>
          {pub.editors.length ? (
            <p style={{ marginTop: 14, fontSize: 14, color: "#aab3c2" }}>
              Edited by <b style={{ color: "var(--cream)" }}>{pub.editors.map((editor) => editor.name).join(", ")}</b>
              {pub.frequency ? ` · ${pub.frequency}` : ""}
            </p>
          ) : null}
        </div>
        <div className="signup-card" id="signup">
          {free ? (
            <>
              <h3>Sign up free</h3>
              <p>Get {pub.name} by email{pub.frequency ? ` (${pub.frequency.toLowerCase()})` : ""}. Unsubscribe any time.</p>
              {signup ? (
                <FormNote status={signup} />
              ) : (
                <form method="post" action={`${base}/subscribe`}>
                  <input type="hidden" name="publicationId" value={pub.id} />
                  <input type="hidden" name="back" value={`${path}#signup`} />
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: "absolute", left: -9999, width: 1, height: 1 }} />
                  <input className="field" type="email" name="email" required placeholder="Your email address" aria-label="Email address" defaultValue={member?.email} />
                  <button className="btn btn-navy">Sign up free</button>
                </form>
              )}
              <p className="fine">We respect your privacy. Your email is never sold.</p>
            </>
          ) : owns ? (
            <>
              <h3>You&apos;re a member</h3>
              <p>Read every issue, the portfolio and special reports in your members area.</p>
              <a className="btn btn-navy" href={`${base}/my/${pub.slug}`}>
                Open {pub.name}
              </a>
            </>
          ) : (
            <>
              <h3>Join {pub.name}</h3>
              <p>{pub.deliverables.length ? `Includes: ${pub.deliverables.slice(0, 4).join(", ")}.` : "Members get every issue, alert and special report."}</p>
              {offer ? (
                <a className="btn btn-navy" href={offer}>
                  See the offer
                </a>
              ) : (
                <p className="fine">Contact customer service to join.</p>
              )}
              <p className="fine" style={{ marginTop: 12 }}>
                Already a member?{" "}
                <a href={`${base}/sign-in?next=${encodeURIComponent(`${base}/my/${pub.slug}`)}`} style={{ color: "var(--dgold)", fontWeight: 600 }}>
                  Sign in
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
  return <Archive loaded={loaded} member={member} where={{ publicationId: pub.id }} title={`${pub.name} archive`} page={page} path={path} active={`/${kind}`} header={header} />;
}
