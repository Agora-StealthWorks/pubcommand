"use client";

import { Button } from "@pubcommand/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type DragEvent } from "react";
import { outlineAction, type OutlineOp } from "./outline-actions";

type TrayCard = { id: string; topic: string; summary: string; cardType: string; groupName: string | null };
type Outline = { id: string; title: string; bullets: { id: string; text: string; cardIds: string[] }[] }[];

const DRAG_TYPE = "application/x-research-card";
const small = "inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-line bg-white px-2 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-40";

function readDrag(event: DragEvent): { cardId: string; fromBulletId: string | null } | null {
  try {
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    const value = raw ? (JSON.parse(raw) as { cardId?: unknown; fromBulletId?: unknown }) : null;
    return value && typeof value.cardId === "string" ? { cardId: value.cardId, fromBulletId: typeof value.fromBulletId === "string" ? value.fromBulletId : null } : null;
  } catch {
    return null;
  }
}

export function OutlineBoard({ projectId, outline, cards, editable }: { projectId: string; outline: Outline; cards: TrayCard[]; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [overBullet, setOverBullet] = useState<string | null>(null);
  const [group, setGroup] = useState("");
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of outline) for (const bullet of section.bullets) for (const id of bullet.cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, [outline]);
  const bulletOptions = useMemo(
    () =>
      outline.flatMap((section, s) =>
        section.bullets.map((bullet, b) => ({ id: bullet.id, label: `${s + 1}.${b + 1} ${bullet.text || "(empty bullet)"}`.slice(0, 70) })),
      ),
    [outline],
  );
  const groups = useMemo(() => [...new Set(cards.map((card) => card.groupName || "__none"))].sort((a, b) => (a === "__none" ? 1 : b === "__none" ? -1 : a.localeCompare(b))), [cards]);
  const trayCards = cards.filter((card) => !group || (card.groupName || "__none") === group);

  const run = (op: OutlineOp) => {
    setError(null);
    startTransition(async () => {
      const result = await outlineAction(projectId, op);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  };

  const onDrop = (event: DragEvent, bulletId: string) => {
    event.preventDefault();
    setOverBullet(null);
    const drag = readDrag(event);
    if (drag && drag.fromBulletId !== bulletId) run({ op: "placeCard", cardId: drag.cardId, bulletId, fromBulletId: drag.fromBulletId });
  };

  const dragStart = (event: DragEvent, cardId: string, fromBulletId: string | null) => {
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ cardId, fromBulletId }));
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        {error ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{error}</p> : null}
        {pending ? <p className="text-xs text-muted" aria-live="polite">Saving…</p> : null}
        {outline.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-white p-6 text-sm text-muted">
            <p>No sections yet. Add one, or start from your topic groups: one section per group and one bullet per card.</p>
            {editable ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" onClick={() => run({ op: "addSection" })} disabled={pending}>
                  Add section
                </Button>
                <Button type="button" variant="secondary" onClick={() => run({ op: "fromGroups" })} disabled={pending || cards.length === 0}>
                  Start from topic groups
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {outline.map((section, s) => (
          <section key={section.id} className="rounded-xl border border-line bg-white p-3 sm:p-4" aria-label={`Section ${s + 1}`}>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-semibold text-muted">{s + 1}.</span>
              {editable ? (
                <input
                  key={`${section.id}:${section.title}`}
                  defaultValue={section.title}
                  aria-label={`Section ${s + 1} title`}
                  maxLength={200}
                  className="pc-control min-w-0 flex-1 font-semibold"
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim();
                    if (title && title !== section.title) run({ op: "renameSection", sectionId: section.id, title });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              ) : (
                <h3 className="pc-break min-w-0 flex-1 font-semibold">{section.title}</h3>
              )}
              {editable ? (
                <div className="flex shrink-0 gap-1">
                  <button type="button" className={small} aria-label="Move section up" disabled={pending || s === 0} onClick={() => run({ op: "moveSection", sectionId: section.id, direction: "up" })}>
                    ↑
                  </button>
                  <button type="button" className={small} aria-label="Move section down" disabled={pending || s === outline.length - 1} onClick={() => run({ op: "moveSection", sectionId: section.id, direction: "down" })}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className={small}
                    aria-label="Delete section"
                    disabled={pending}
                    onClick={() => {
                      if (section.bullets.length === 0 || window.confirm(`Delete "${section.title}" and its ${section.bullets.length} bullets? The cards stay in the project.`)) run({ op: "deleteSection", sectionId: section.id });
                    }}
                  >
                    ✕
                  </button>
                </div>
              ) : null}
            </div>

            <ul className="mt-3 space-y-2">
              {section.bullets.map((bullet, b) => (
                <li
                  key={bullet.id}
                  onDragOver={
                    editable
                      ? (event) => {
                          if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                            event.preventDefault();
                            setOverBullet(bullet.id);
                          }
                        }
                      : undefined
                  }
                  onDragLeave={editable ? () => setOverBullet((current) => (current === bullet.id ? null : current)) : undefined}
                  onDrop={editable ? (event) => onDrop(event, bullet.id) : undefined}
                  className={`rounded-lg border p-2 ${overBullet === bullet.id ? "border-accent bg-[#eef4ff]" : "border-line bg-canvas"}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-3 shrink-0 text-xs text-muted" aria-hidden>
                      •
                    </span>
                    {editable ? (
                      <textarea
                        key={`${bullet.id}:${bullet.text}`}
                        defaultValue={bullet.text}
                        rows={1}
                        aria-label={`Bullet ${s + 1}.${b + 1}`}
                        placeholder="Write the point this bullet makes"
                        className="pc-control min-w-0 flex-1 resize-y bg-white text-sm"
                        onBlur={(event) => {
                          const value = event.currentTarget.value.trim();
                          if (value !== bullet.text) run({ op: "editBullet", bulletId: bullet.id, text: value });
                        }}
                      />
                    ) : (
                      <p className="pc-break min-w-0 flex-1 py-2 text-sm">{bullet.text || <span className="text-muted">(empty bullet)</span>}</p>
                    )}
                    {editable ? (
                      <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                        <button type="button" className={small} aria-label="Move bullet up" disabled={pending || b === 0} onClick={() => run({ op: "moveBullet", bulletId: bullet.id, direction: "up" })}>
                          ↑
                        </button>
                        <button type="button" className={small} aria-label="Move bullet down" disabled={pending || b === section.bullets.length - 1} onClick={() => run({ op: "moveBullet", bulletId: bullet.id, direction: "down" })}>
                          ↓
                        </button>
                        <button type="button" className={small} aria-label="Delete bullet" disabled={pending} onClick={() => run({ op: "deleteBullet", bulletId: bullet.id })}>
                          ✕
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {bullet.cardIds.length ? (
                    <ul className="mt-2 space-y-1.5 sm:pl-5">
                      {bullet.cardIds.map((cardId, c) => {
                        const card = byId.get(cardId);
                        if (!card) return null;
                        return (
                          <li
                            key={cardId}
                            draggable={editable}
                            onDragStart={editable ? (event) => dragStart(event, cardId, bullet.id) : undefined}
                            className="rounded-md border border-line bg-white px-2 py-1.5"
                          >
                            <div className="flex items-start gap-2">
                              <a href={`?tab=research#card-${cardId}`} className="pc-break min-w-0 flex-1 text-sm font-medium hover:text-accent">
                                {card.topic}
                              </a>
                              {editable ? (
                                <div className="flex shrink-0 gap-1">
                                  <button type="button" className={small} aria-label="Move card up" disabled={pending || c === 0} onClick={() => run({ op: "moveCardStep", cardId, bulletId: bullet.id, direction: "up" })}>
                                    ↑
                                  </button>
                                  <button type="button" className={small} aria-label="Move card down" disabled={pending || c === bullet.cardIds.length - 1} onClick={() => run({ op: "moveCardStep", cardId, bulletId: bullet.id, direction: "down" })}>
                                    ↓
                                  </button>
                                  <button type="button" className={small} aria-label="Remove card from bullet" disabled={pending} onClick={() => run({ op: "removeCard", cardId, bulletId: bullet.id })}>
                                    ✕
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            <p className="pc-break mt-0.5 line-clamp-2 text-xs text-muted">{card.summary}</p>
                            {editable && bulletOptions.length > 1 ? (
                              <select
                                className="pc-control mt-1 w-full text-xs"
                                aria-label={`Move "${card.topic}" to another bullet`}
                                value=""
                                disabled={pending}
                                onChange={(event) => {
                                  if (event.target.value) run({ op: "placeCard", cardId, bulletId: event.target.value, fromBulletId: bullet.id });
                                }}
                              >
                                <option value="">Move to bullet…</option>
                                {bulletOptions
                                  .filter((option) => option.id !== bullet.id)
                                  .map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}
                                    </option>
                                  ))}
                              </select>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : editable ? (
                    <p className="mt-1 text-xs text-muted sm:pl-5">Drag a card here, or use “Add to bullet” on a card.</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {editable ? (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = event.currentTarget.elements.namedItem("bullet") as HTMLInputElement;
                  run({ op: "addBullet", sectionId: section.id, text: input.value });
                  input.value = "";
                }}
              >
                <input name="bullet" placeholder="New bullet" aria-label={`New bullet in section ${s + 1}`} maxLength={1000} className="pc-control min-w-0 flex-1 text-sm" />
                <Button type="submit" variant="secondary" disabled={pending}>
                  Add
                </Button>
              </form>
            ) : null}
          </section>
        ))}
        {editable && outline.length ? (
          <Button type="button" variant="secondary" onClick={() => run({ op: "addSection" })} disabled={pending}>
            + Add section
          </Button>
        ) : null}
      </div>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Cards · {cards.length}</h3>
            {groups.length > 1 ? (
              <select className="pc-control max-w-[60%] text-xs" aria-label="Show cards from group" value={group} onChange={(event) => setGroup(event.target.value)}>
                <option value="">All groups</option>
                {groups.map((name) => (
                  <option key={name} value={name}>
                    {name === "__none" ? "Ungrouped" : name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
            {trayCards.map((card) => (
              <li key={card.id} draggable={editable} onDragStart={editable ? (event) => dragStart(event, card.id, null) : undefined} className={`rounded-lg border border-line p-2 ${editable ? "cursor-grab bg-white active:cursor-grabbing" : ""}`}>
                <p className="pc-break text-sm font-medium">{card.topic}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {card.groupName || "Ungrouped"}
                  {usage.get(card.id) ? ` · on ${usage.get(card.id)} bullet${usage.get(card.id) === 1 ? "" : "s"}` : ""}
                </p>
                {editable && bulletOptions.length ? (
                  <select
                    className="pc-control mt-1 w-full text-xs"
                    aria-label={`Add "${card.topic}" to a bullet`}
                    value=""
                    disabled={pending}
                    onChange={(event) => {
                      if (event.target.value) run({ op: "placeCard", cardId: card.id, bulletId: event.target.value });
                    }}
                  >
                    <option value="">Add to bullet…</option>
                    {bulletOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </li>
            ))}
            {trayCards.length === 0 ? <li className="p-2 text-sm text-muted">No cards yet. Add sources on the Research tab.</li> : null}
          </ul>
        </div>
      </aside>
    </div>
  );
}
