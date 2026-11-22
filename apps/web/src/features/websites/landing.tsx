import type { Publication } from "@/features/pubsetup/read";
import { Archive } from "./archive";
import type { SignedInMember } from "./members";
import type { LoadedSite } from "./public";
import { PubBadge } from "./site-view";

/** A publication's full archive (its page shows only the latest issues and links here with ?page=). */
export async function PublicationArchive({ loaded, member, pub, page, kind }: { loaded: LoadedSite; member: SignedInMember | null; pub: Publication; page: number; kind: "newsletters" | "research" }) {
  const { base } = loaded;
  const path = `${base}/${kind}/${pub.slug}`;
  const header = (
    <section className="mast dark" style={{ padding: "28px 0" }}>
      <div className="wrap">
        <PubBadge loaded={loaded} pub={pub} size="lg" sub={pub.frequency ?? ""} />
        <p style={{ marginTop: 14 }}>
          <a href={path} className="lnk" style={{ color: "var(--gold)" }}>
            ← About {pub.name}
          </a>
        </p>
      </div>
    </section>
  );
  return <Archive loaded={loaded} member={member} where={{ publicationId: pub.id }} title={`${pub.name} archive`} page={page} path={path} active={`/${kind}`} header={header} />;
}
