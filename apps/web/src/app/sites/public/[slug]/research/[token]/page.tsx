import { resolveOrgBySlug } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { isPublicToken } from "../../../../../../../../../modules/research/access";
import { CARD_TYPE_LABELS } from "../../../../../../../../../modules/research/extract";
import { loadProjectContents, projectByPublicToken, type CardView } from "@/features/research/data";

function CardBody({ card }: { card: CardView }) {
  return (
    <>
      <p className="pc-break text-sm">{card.summary}</p>
      {card.keyPoints.length ? (
        <ul className="mt-2 space-y-1 border-l-2 border-line pl-3 text-sm">
          {card.keyPoints.map((point, index) => (
            <li key={index} className="pc-break">
              {point.text}
              {point.location ? <span className="ml-1 text-xs text-muted">({point.location})</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {card.sourceLabel ? (
        <p className="pc-break mt-2 text-xs text-muted">
          Source:{" "}
          {card.sourceUrl ? (
            <a href={card.sourceUrl} target="_blank" rel="noreferrer noopener nofollow" className="text-accent hover:underline">
              {card.sourceLabel}
            </a>
          ) : (
            card.sourceLabel
          )}
        </p>
      ) : null}
    </>
  );
}

export default async function PublicResearchPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  if (!isPublicToken(token)) notFound();
  const org = await resolveOrgBySlug(slug);
  if (!org || org.suspendedAt || org.redirected) notFound();
  const found = await projectByPublicToken(org.id, token);
  if (!found) notFound();
  const { cards, outline } = await loadProjectContents(org.id, found.project.id);
  const byId = new Map(cards.map((card) => [card.id, card]));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{found.brandName} · Research</p>
        <h1 className="pc-break mt-1 text-2xl font-semibold">{found.project.name}</h1>
        {found.project.description ? <p className="pc-break mt-2 text-sm text-muted">{found.project.description}</p> : null}
      </header>

      {outline.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Outline</h2>
          {outline.map((section, s) => (
            <div key={section.id} className="rounded-xl border border-line bg-white p-4">
              <h3 className="pc-break font-semibold">
                {s + 1}. {section.title}
              </h3>
              <ul className="mt-2 space-y-3">
                {section.bullets.map((bullet) => (
                  <li key={bullet.id}>
                    <p className="pc-break text-sm font-medium">• {bullet.text || "(empty bullet)"}</p>
                    {bullet.cardIds.map((id) => byId.get(id)).filter((card): card is CardView => Boolean(card)).map((card) => (
                      <div key={card.id} className="mt-2 rounded-lg border border-line bg-canvas p-3 sm:ml-4">
                        <p className="pc-break text-sm font-semibold">{card.topic}</p>
                        <CardBody card={card} />
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">Index cards · {cards.length}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <article key={card.id} className="min-w-0 rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-muted">
                {CARD_TYPE_LABELS[card.cardType] ?? "Note"}
                {card.groupName ? ` · ${card.groupName}` : ""}
              </p>
              <h3 className="pc-break mt-1 font-semibold">{card.topic}</h3>
              <div className="mt-1">
                <CardBody card={card} />
              </div>
            </article>
          ))}
        </div>
        {cards.length === 0 ? <p className="mt-2 text-sm text-muted">No cards yet.</p> : null}
      </section>
    </div>
  );
}
