import { Badge, Button, Input, Label, Textarea } from "@pubcommand/ui";
import { CARD_TYPE_LABELS, CARD_TYPES, type CardType } from "../../../../../modules/research/extract";
import { createCard, deleteCard, updateCard } from "./actions";
import type { CardView } from "./data";

const TYPE_TONE: Record<CardType, "neutral" | "accent" | "ok" | "warn"> = { fact: "neutral", stat: "accent", quote: "ok", story: "warn", angle: "warn", other: "neutral" };

function CardFields({ card, groups, prefix }: { card?: CardView; groups: string[]; prefix: string }) {
  const points = card?.keyPoints.map((point) => (point.location ? `${point.text} | ${point.location}` : point.text)).join("\n") ?? "";
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`${prefix}-topic`}>Topic</Label>
        <Input id={`${prefix}-topic`} name="topic" required maxLength={200} defaultValue={card?.topic} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-summary`}>Summary</Label>
        <Textarea id={`${prefix}-summary`} name="summary" rows={3} required maxLength={2000} defaultValue={card?.summary} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-details`}>More detail (optional)</Label>
        <Textarea id={`${prefix}-details`} name="details" rows={3} maxLength={6000} defaultValue={card?.details} />
      </div>
      <div>
        <Label htmlFor={`${prefix}-points`}>Key facts and quotes, one per line</Label>
        <Textarea id={`${prefix}-points`} name="keyPoints" rows={3} defaultValue={points} placeholder="Exact wording | where it is (p. 4, 12:30)" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${prefix}-type`}>Type</Label>
          <select id={`${prefix}-type`} name="cardType" defaultValue={card?.cardType ?? "fact"} className="pc-control w-full">
            {CARD_TYPES.map((type) => (
              <option key={type} value={type}>
                {CARD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${prefix}-group`}>Group</Label>
          <Input id={`${prefix}-group`} name="groupName" maxLength={60} defaultValue={card?.groupName ?? ""} list={`${prefix}-groups`} />
          <datalist id={`${prefix}-groups`}>
            {groups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </div>
        <div>
          <Label htmlFor={`${prefix}-tags`}>Tags</Label>
          <Input id={`${prefix}-tags`} name="tags" maxLength={400} defaultValue={card?.tags.join(", ")} placeholder="comma, separated" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-source`}>Source</Label>
          <Input id={`${prefix}-source`} name="sourceLabel" maxLength={200} defaultValue={card?.sourceLabel} />
        </div>
        <div>
          <Label htmlFor={`${prefix}-url`}>Source link</Label>
          <Input id={`${prefix}-url`} name="sourceUrl" type="url" defaultValue={card?.sourceUrl ?? ""} placeholder="https://" />
        </div>
      </div>
    </div>
  );
}

export function NewCardForm({ projectId, groups, open }: { projectId: string; groups: string[]; open: boolean }) {
  return (
    <details open={open} className="rounded-xl border border-line bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-accent">+ Add a card by hand</summary>
      <form action={createCard} className="mt-3 space-y-3">
        <input type="hidden" name="projectId" value={projectId} />
        <CardFields groups={groups} prefix="new-card" />
        <Button type="submit">Add card</Button>
      </form>
    </details>
  );
}

export function CardItem({ card, projectId, groups, editable, sourceTitle }: { card: CardView; projectId: string; groups: string[]; editable: boolean; sourceTitle?: string }) {
  const label = card.sourceLabel || sourceTitle || "";
  return (
    <article id={`card-${card.id}`} className="flex min-w-0 flex-col rounded-xl border border-line bg-white p-4 target:border-accent target:ring-2 target:ring-[#c7d7fe]">
      <header className="flex items-start justify-between gap-2">
        <h4 className="pc-break font-semibold leading-snug">{card.topic}</h4>
        <div className="flex shrink-0 gap-1">
          <Badge tone={TYPE_TONE[card.cardType] ?? "neutral"}>{CARD_TYPE_LABELS[card.cardType] ?? "Note"}</Badge>
          {card.origin === "manual" ? <Badge>Manual</Badge> : null}
        </div>
      </header>
      <p className="pc-break mt-2 text-sm">{card.summary}</p>
      {card.details ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-accent">More detail</summary>
          <p className="pc-break mt-1 whitespace-pre-line text-muted">{card.details}</p>
        </details>
      ) : null}
      {card.keyPoints.length ? (
        <ul className="mt-3 space-y-1.5 border-l-2 border-line pl-3 text-sm">
          {card.keyPoints.map((point, index) => (
            <li key={index} className="pc-break">
              {point.kind === "quote" ? <span className="italic">{point.text}</span> : point.text}
              {point.location ? <span className="ml-1 text-xs text-muted">({point.location})</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <footer className="mt-auto pt-3 text-xs text-muted">
        {label ? (
          <p className="pc-break">
            Source:{" "}
            {card.sourceUrl ? (
              <a href={card.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                {label}
              </a>
            ) : (
              label
            )}
          </p>
        ) : null}
        {card.tags.length ? (
          <p className="mt-1 flex flex-wrap gap-1">
            {card.tags.map((tag) => (
              <a key={tag} href={`?tag=${encodeURIComponent(tag)}`} className="rounded-full bg-canvas px-2 py-0.5 hover:text-accent">
                #{tag}
              </a>
            ))}
          </p>
        ) : null}
      </footer>
      {editable ? (
        <details className="mt-3 border-t border-line pt-2">
          <summary className="cursor-pointer text-xs font-semibold text-accent">Edit card</summary>
          <form action={updateCard} className="mt-3 space-y-3">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="cardId" value={card.id} />
            <CardFields card={card} groups={groups} prefix={`card-${card.id}`} />
            <Button type="submit">Save card</Button>
          </form>
          <form action={deleteCard} className="mt-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="cardId" value={card.id} />
            <Button type="submit" variant="danger">
              Delete card
            </Button>
          </form>
        </details>
      ) : null}
    </article>
  );
}
