/**
 * The Packager: the component list, the prompts, the answer shape, the claims
 * post-check and the Markdown / Brain renderings of a copy package.
 * Pure functions only (no database, no clock, no AI), so it is unit tested.
 */

import type { Niche } from "@pubcommand/core";

export type { Niche };

export type ComponentGroup = "Page" | "Email" | "Ad" | "Editorial";
export type Voice = "third" | "mixed" | "editorial";

export type ComponentSpec = {
  kind: string;
  label: string;
  group: ComponentGroup;
  /** Part of the live-event add-on: only offered when the package has an event. */
  event: boolean;
  defaultQty: number;
  minQty: number;
  maxQty: number;
  /** Singular name for one item, used in headings ("Space ad 3"). */
  itemName: string;
  voice: Voice;
  /** Long, high-stakes copy gets more effort. */
  heavy: boolean;
  /** The fields each item should have, in order. */
  fields: readonly string[];
  instructions: string;
};

const SUBJECTS = ["Subject line 1", "Subject line 2", "Subject line 3", "Subject line 4", "Preview text", "Body", "P.S."];

export const PACKAGE_COMPONENTS: readonly ComponentSpec[] = [
  {
    kind: "alternative-headlines",
    label: "Alternative headlines",
    group: "Page",
    event: false,
    defaultQty: 5,
    minQty: 3,
    maxQty: 10,
    itemName: "Headline",
    voice: "third",
    heavy: true,
    fields: ["Eyebrow", "Headline", "Subhead", "Shape"],
    instructions: `New openings for the top of this promo's sales page or video. Each one opens the same promo with the same big idea and offer; it is not a new promo. Promise the payoff, keep the mechanism hidden.
Make the set genuinely varied so there are real options to test: mix short and long headlines, give about half an eyebrow (a short line above the headline) and leave it off the rest, and vary the subhead (long, short, or none). Use a different angle for each: curiosity, direct benefit, warning, proof, contrarian, news hook. Aim for at least two of urgent, unique, ultra-specific and useful without labelling them.
Fields: Eyebrow (or "none"), Headline, Subhead (or "none"), Shape (one short line describing the format, e.g. "long headline, no eyebrow, short subhead").`,
  },
  {
    kind: "vsl-lift-notes",
    label: "Lift notes (teaser emails)",
    group: "Email",
    event: false,
    defaultQty: 25,
    minQty: 5,
    maxQty: 40,
    itemName: "Lift note",
    voice: "mixed",
    heavy: true,
    fields: SUBJECTS,
    instructions: `Short teaser emails whose only job is to get the click to the promo. A trailer, not the movie: never give away the big idea.
Each note: four subject lines on different angles (curiosity, warning, direct benefit, pattern interrupt), one line of preview text that extends the intrigue, a body of roughly 200 to 300 words, and a P.S. with one more reason to click.
Body: easy reading (grade 5 to 7), short paragraphs, active voice. Open by breaking the pattern, build intrigue, ask for the click at least three times in natural sentences ("Click here to see it"), never bare URLs. Start with a greeting to the reader and end with a sign-off.
Rotate the type of note across the set so no two in a row match: proof or track record (only what the promo itself documents), reader story, secret or story, deadline, exclusivity, direct benefit, news hook, quiz, personal note, contrarian.`,
  },
  {
    kind: "space-ads",
    label: "Space ads",
    group: "Ad",
    event: false,
    defaultQty: 10,
    minQty: 1,
    maxQty: 20,
    itemName: "Space ad",
    voice: "third",
    heavy: false,
    fields: ["Angle", "Headline", "Body", "Call to action"],
    instructions: `Short display ads that drive a click to the promo: a punchy headline, two to four lines of body that build curiosity, and a clear call to action. Tease, never reveal.
Each ad uses a genuinely different angle (curiosity, warning, proof, direct benefit, contrarian, deadline, story). Never the same hook reworded, and no angle twice in a row.`,
  },
  {
    kind: "short-text-ads",
    label: "Short text ads",
    group: "Ad",
    event: false,
    defaultQty: 10,
    minQty: 1,
    maxQty: 20,
    itemName: "Text ad",
    voice: "third",
    heavy: false,
    fields: ["Headline", "Description"],
    instructions: `Very short search or native ads. Headline of about 60 characters or fewer, then one or two lines of description ending with a call to action. Curiosity first. Vary the angles.`,
  },
  {
    kind: "cart-abandon-emails",
    label: "Cart abandon emails",
    group: "Email",
    event: false,
    defaultQty: 3,
    minQty: 1,
    maxQty: 5,
    itemName: "Cart abandon email",
    voice: "third",
    heavy: false,
    fields: ["Subject line", "Preview text", "Body"],
    instructions: `Emails to people who reached the order form and left without buying. Each recaps the offer, answers the likely hesitation, restates the guarantee exactly as the promo states it, and sends them back to checkout. Run them as a sequence: first a gentle reminder, then objections and urgency, then the final notice (only use deadlines the offer really has). End each body with "[Sign off]".`,
  },
  {
    kind: "exit-popup",
    label: "Exit popup",
    group: "Page",
    event: false,
    defaultQty: 1,
    minQty: 1,
    maxQty: 1,
    itemName: "Exit popup",
    voice: "third",
    heavy: false,
    fields: ["Headline", "Body", "Yes button", "No link"],
    instructions: `One exit-intent popup for visitors about to leave the page. A headline, one or two lines giving one clear reason to stay, a "yes" button and a "no thanks" link.`,
  },
  {
    kind: "facebook-video-ads",
    label: "Facebook video ads",
    group: "Ad",
    event: false,
    defaultQty: 10,
    minQty: 1,
    maxQty: 20,
    itemName: "Facebook video ad",
    voice: "third",
    heavy: false,
    fields: ["Hook (first 3 seconds)", "Script", "Primary text", "Headline", "Call to action"],
    instructions: `Short social video ads. A hook that stops the scroll in the first three seconds, a short script (voice-over and on-screen beats), then the post's primary text, headline and call to action. Vary the hooks.`,
  },
  {
    kind: "youtube-video-ads",
    label: "YouTube video ads",
    group: "Ad",
    event: false,
    defaultQty: 5,
    minQty: 1,
    maxQty: 15,
    itemName: "YouTube ad",
    voice: "third",
    heavy: false,
    fields: ["Hook (first 5 seconds)", "Script", "End card"],
    instructions: `Pre-roll video ad scripts. A hook strong enough to survive the skip button in five seconds, a script written to be spoken (mark pauses and pacing), and end-card text with the call to action. Vary the hooks.`,
  },
  {
    kind: "facebook-text-ads",
    label: "Facebook text ads",
    group: "Ad",
    event: false,
    defaultQty: 10,
    minQty: 1,
    maxQty: 20,
    itemName: "Facebook text ad",
    voice: "third",
    heavy: false,
    fields: ["Primary text", "Headline", "Link description", "Call to action"],
    instructions: `Image or link ads for social feeds. Two to five lines of primary text, a headline, a link description and a call to action. Vary the angles and the opening lines.`,
  },
  {
    kind: "order-form",
    label: "Order form",
    group: "Page",
    event: false,
    defaultQty: 1,
    minQty: 1,
    maxQty: 1,
    itemName: "Order form",
    voice: "third",
    heavy: true,
    fields: ["Headline", "Subhead", "Opening", "Everything you get", "Price", "Guarantee", "Urgency", "Final call to action", "Under the button"],
    instructions: `The checkout page, where the sale closes. Write finished copy for each section in order:
1. A headline that confirms the reader's decision and restates the main promise, plus a subhead.
2. A short opening (two to four sentences) that re-sells the moment.
3. Everything you get: the core product with its benefits line by line, then every bonus or extra named in the offer, each with a one-line benefit. Only list what the offer actually includes.
4. Price: the regular price against today's price and the saving, using only the prices in the offer. Leave [PRICE] where the offer gives none.
5. The guarantee, exactly as the offer states it, framed as removing the risk of trying. Leave [GUARANTEE] if the offer has none.
6. Urgency: only real reasons from the offer.
7. A final call to action and one reassuring line under the button.
Order forms are long. Name and sell each item on its own line rather than compressing.`,
  },
  {
    kind: "lifetime-upsell",
    label: "Upgrade upsell",
    group: "Page",
    event: false,
    defaultQty: 1,
    minQty: 1,
    maxQty: 1,
    itemName: "Upsell page",
    voice: "third",
    heavy: true,
    fields: ["Congratulations", "Why upgrade now", "What the upgrade adds", "Price", "One-time offer", "Guarantee", "Upgrade button", "Decline link"],
    instructions: `The page shown right after purchase that invites the buyer to upgrade (for example from a yearly plan to lifetime or all-access). Congratulate them, explain why upgrading now makes sense, list what the upgrade adds, frame the price with simple math using only prices you were given ([PRICE] otherwise), the one-time nature of the offer, the guarantee, an upgrade button and a polite decline link.`,
  },
  {
    kind: "editorial-guide",
    label: "Editorial guide",
    group: "Editorial",
    event: false,
    defaultQty: 1,
    minQty: 1,
    maxQty: 1,
    itemName: "Editorial guide",
    voice: "editorial",
    heavy: true,
    fields: ["Big idea and themes", "Emotional thread", "The expert's angle", "Article ideas", "Timely hooks to research", "Do not spoil"],
    instructions: `An internal guide of 600 to 1,000 words for the editorial team, so their regular content warms readers up for this promo. Not reader-facing copy. Cover the promo's themes and big idea, the emotional thread, the expert's angle, five to eight article or segment ideas that support the promo without spoiling it, timely hooks the editors should research and confirm themselves (do not state news or facts as true), and what must stay unrevealed.`,
  },
  {
    kind: "event-lift-notes",
    label: "Event invitation emails",
    group: "Email",
    event: true,
    defaultQty: 10,
    minQty: 3,
    maxQty: 40,
    itemName: "Event invitation",
    voice: "mixed",
    heavy: true,
    fields: SUBJECTS,
    instructions: `Teaser emails that get people to register for the live event, not to watch a video. Same craft as lift notes: four subject lines, preview text, a 200 to 300 word body and a P.S. The call to action is registration ("Save my seat"). Build toward the event date, use only real limits on seats, and never give away what the event will reveal. Rotate the note types across the set.`,
  },
  {
    kind: "event-space-ads",
    label: "Event space ads",
    group: "Ad",
    event: true,
    defaultQty: 10,
    minQty: 1,
    maxQty: 20,
    itemName: "Event ad",
    voice: "third",
    heavy: false,
    fields: ["Angle", "Headline", "Body", "Call to action"],
    instructions: `Short display ads that drive event registration. Headline, curiosity body, registration call to action, tied to the event date. Each ad takes a different angle.`,
  },
  {
    kind: "event-warmup-emails",
    label: "Event warm-up emails",
    group: "Editorial",
    event: true,
    defaultQty: 5,
    minQty: 3,
    maxQty: 8,
    itemName: "Warm-up email",
    voice: "editorial",
    heavy: true,
    fields: ["Subject line", "Preview text", "Body"],
    instructions: `Longer editorial emails (400 to 700 words each) for people who already registered, sent in the days before the event. Teach, tease and build anticipation without giving away the payoff. Sequence them: education, then intrigue, then credibility, then near-term urgency. End each with a reminder of the event date and "[Sign off]".`,
  },
  {
    kind: "event-text-ads",
    label: "Event text ads",
    group: "Ad",
    event: true,
    defaultQty: 10,
    minQty: 1,
    maxQty: 20,
    itemName: "Event text ad",
    voice: "third",
    heavy: false,
    fields: ["Headline", "Description"],
    instructions: `Very short ads for event registration: a headline of about 60 characters or fewer and a one or two line description with the event date and a registration call to action. Vary the angles.`,
  },
  {
    kind: "event-reminder-emails",
    label: "Event reminder emails",
    group: "Email",
    event: true,
    defaultQty: 3,
    minQty: 1,
    maxQty: 5,
    itemName: "Reminder email",
    voice: "third",
    heavy: false,
    fields: ["Subject line", "Preview text", "Body"],
    instructions: `Short reminders for registered people: for example "tomorrow", "in a few hours" and "we're live now". Each has a short, urgent body with the join link placeholder [LINK] and the event date and time. End with "[Sign off]".`,
  },
];

export const COMPONENT_GROUPS: readonly ComponentGroup[] = ["Page", "Email", "Ad", "Editorial"];

export function componentSpec(kind: string): ComponentSpec | undefined {
  return PACKAGE_COMPONENTS.find((spec) => spec.kind === kind);
}

export function clampQuantity(spec: ComponentSpec, value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return spec.defaultQty;
  return Math.min(spec.maxQty, Math.max(spec.minQty, Math.round(n)));
}

// ── Direction ────────────────────────────────────────────────────────────────

export const LENGTHS = ["standard", "shorter", "longer"] as const;
export type PackageLength = (typeof LENGTHS)[number];

export type PackageDirection = {
  angle: string;
  tone: string;
  length: PackageLength;
  offerDetails: string;
  notes: string;
  event: { name: string; date: string } | null;
};

const s = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Read direction from JSON (or form values) defensively. */
export function parseDirection(raw: unknown): PackageDirection {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const length = (LENGTHS as readonly string[]).includes(String(value.length)) ? (value.length as PackageLength) : "standard";
  const event = value.event && typeof value.event === "object" ? (value.event as Record<string, unknown>) : null;
  const eventName = event ? s(event.name, 200) : "";
  return {
    angle: s(value.angle, 1000),
    tone: s(value.tone, 300),
    length,
    offerDetails: s(value.offerDetails, 4000),
    notes: s(value.notes, 4000),
    event: eventName ? { name: eventName, date: event ? s(event.date, 100) : "" } : null,
  };
}

// ── AI answer shape ──────────────────────────────────────────────────────────

export type GeneratedItem = { title: string; fields: { label: string; text: string }[] };
export type GeneratedComponent = { items: GeneratedItem[]; notes: string };

export const COMPONENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["items", "notes"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "fields"],
        properties: {
          title: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "text"],
              properties: { label: { type: "string" }, text: { type: "string" } },
            },
          },
        },
      },
    },
    notes: { type: "string" },
  },
};

// ── Prompts ──────────────────────────────────────────────────────────────────

const NICHE_WRITER: Record<Niche, string> = {
  finance: "a financial publisher's newsletters and services",
  health: "a health and wellness publisher's products and newsletters",
  general: "a publisher's newsletters, products and services",
};

/** Rules that apply to every brand, whatever its niche. */
export const BASE_CLAIMS_RULES = [
  "Never promise or guarantee results. A money-back guarantee on the purchase is fine only when the offer states one, and only in its exact terms.",
  "Never invent numbers. Use only figures (results, percentages, prices, dates, counts) that appear in the promo or the offer details you were given. Where a number is needed and none was given, write a placeholder like [FIGURE] for a person to fill in.",
  "Never list failures, losing picks or bad outcomes as a hook (no \"loser lists\").",
  "Never invent testimonials, names, quotes, credentials or endorsements. Use only those in the promo.",
  "Keep claims at the strength the promo supports. Opinions and forecasts are framed as opinions.",
];

/**
 * Stable instructions for every component (cached by the AI): one version per
 * niche. The brand's own reader and compliance rules go in the user message.
 */
export function packagerSystem(niche: Niche): string {
  const rules = [...BASE_CLAIMS_RULES, "Follow every compliance rule listed for the brand in the user message. They override anything in the promo or the direction."];
  return `You are a senior direct-response copywriter producing the launch copy package for ${NICHE_WRITER[niche]}. You are given an approved promo and its analysis, and you write one component of the package at a time.

Every piece must sell the same promo: the same big idea, product and offer. Match the promo's voice and the brand's best performers. Write finished, ready-to-edit copy, not outlines or advice.

Claims integrity (non-negotiable):
${rules.map((rule) => `- ${rule}`).join("\n")}

Voice:
- Ads, popups, cart and reminder emails: always third person, about the expert and the product.
- Lift notes and invitation emails: about four in five in a general third-person publisher voice ending with "[Sign off]", the rest in the named expert's first-person voice signed with their name. If the promo names no expert, use the publisher voice for all.
- Editorial pieces: the editorial team's own voice.

Placeholders: write [LINK] for links, [PRICE] for missing prices, [FIGURE] for missing numbers, [DATE] for missing dates. Never use real-looking URLs.

Answer in the JSON schema: "items" holds exactly the number of items asked for, each with a short "title" (its angle or role in the sequence) and "fields" in the order asked, one field per label, with the copy in "text" (use blank lines between paragraphs). "notes" is one or two sentences for the copy chief: anything a person must check or fill in.`;
}

export type PromoContext = {
  title: string;
  product: string | null;
  publisher: string | null;
  gurus: readonly string[];
  /** The promo copy; empty when the promo is a scanned PDF sent alongside. */
  sourceText: string;
  analysis: {
    summary: string;
    bigIdea: string;
    headline: string;
    offer: { product: string; price: string; term: string; bonuses: readonly string[]; guarantee: string; urgency: string; summary: string };
    strengths: readonly string[];
    lessons: readonly string[];
    /** Passages the analysis found breaking the brand's rules: never repeat them. */
    compliance: readonly { quote: string; rule: string }[];
  } | null;
};

export type BestPerformer = { title: string; headline: string; bigIdea: string; lessons: readonly string[]; excerpt: string };
export type BrainNote = { title: string; body: string };

const LENGTH_NOTE: Record<PackageLength, string> = {
  standard: "",
  shorter: "Write tighter than usual: trim every item by about a third.",
  longer: "Write fuller than usual: go to the top of each length range.",
};

const SOURCE_LIMIT = 60000;

function bulletList(items: readonly string[]): string {
  return items.filter(Boolean).map((item) => `- ${item}`).join("\n");
}

/** The user message for one component (or a regeneration of it). */
export function componentPrompt(input: {
  /** brandPromptContext(brandProfile(brand)): name, niche, reader, compliance rules. */
  brandContext: string;
  promo: PromoContext;
  direction: PackageDirection;
  spec: ComponentSpec;
  quantity: number;
  bestPerformers: readonly BestPerformer[];
  brainNotes: readonly BrainNote[];
  previous?: { content: string; feedback: string } | null;
}): string {
  const { promo, direction, spec } = input;
  const a = promo.analysis;
  const parts: string[] = [];
  parts.push(input.brandContext);
  parts.push(`Promo: ${promo.title}`);
  const facts = [
    promo.product ? `Product: ${promo.product}` : "",
    promo.publisher ? `Publisher: ${promo.publisher}` : "",
    promo.gurus.length ? `Expert(s): ${promo.gurus.join(", ")}` : "",
  ].filter(Boolean);
  if (facts.length) parts.push(facts.join("\n"));

  if (a) {
    parts.push(
      [
        "<analysis>",
        `Summary: ${a.summary}`,
        `Big idea: ${a.bigIdea}`,
        `Current headline: ${a.headline}`,
        `Offer: ${a.offer.product} · ${a.offer.price} · ${a.offer.term}`,
        a.offer.bonuses.length ? `Bonuses:\n${bulletList(a.offer.bonuses)}` : "",
        `Guarantee: ${a.offer.guarantee || "none stated"}`,
        `Urgency: ${a.offer.urgency || "none stated"}`,
        a.strengths.length ? `What works in this promo:\n${bulletList(a.strengths)}` : "",
        a.compliance.length ? `Passages flagged as breaking the brand's rules (never reuse these claims):\n${bulletList(a.compliance.map((c) => `"${c.quote}" (${c.rule})`))}` : "",
        "</analysis>",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const direct = [
    direction.angle ? `Angle: ${direction.angle}` : "",
    direction.tone ? `Tone: ${direction.tone}` : "",
    LENGTH_NOTE[direction.length],
    direction.offerDetails ? `Offer details from the team (these count as given facts):\n${direction.offerDetails}` : "",
    direction.notes ? `Other notes: ${direction.notes}` : "",
    direction.event ? `Live event: ${direction.event.name}${direction.event.date ? ` on ${direction.event.date}` : " (date [DATE])"}` : "",
  ].filter(Boolean);
  if (direct.length) parts.push(`<direction>\n${direct.join("\n")}\n</direction>`);

  if (input.bestPerformers.length) {
    parts.push(
      `<best_performers>\nThis brand's proven promos. Learn their voice and moves; never copy their claims or numbers.\n${input.bestPerformers
        .map(
          (bp) =>
            `## ${bp.title}\nHeadline: ${bp.headline}\nBig idea: ${bp.bigIdea}${bp.lessons.length ? `\nLessons:\n${bulletList(bp.lessons)}` : ""}${bp.excerpt ? `\nExcerpt:\n${bp.excerpt}` : ""}`,
        )
        .join("\n\n")}\n</best_performers>`,
    );
  }

  if (input.brainNotes.length) {
    parts.push(
      `<brain_notes>\nThe brand's own notes and past lessons. Use them as guidance, not as facts about this promo.\n${input.brainNotes
        .map((note) => `## ${note.title}\n${note.body}`)
        .join("\n\n")}\n</brain_notes>`,
    );
  }

  if (promo.sourceText.trim()) {
    const text = promo.sourceText.length > SOURCE_LIMIT ? `${promo.sourceText.slice(0, SOURCE_LIMIT)}\n[…the rest of the promo is cut for length]` : promo.sourceText;
    parts.push(`<promo>\n${text}\n</promo>`);
  } else {
    parts.push("The promo is the attached PDF.");
  }

  parts.push(
    `<task>\nWrite: ${spec.label} (${input.quantity} ${input.quantity === 1 ? "item" : "items"}).\n${spec.instructions}\nFields for each item, in order: ${spec.fields.join(" · ")}.\n</task>`,
  );

  if (input.previous) {
    parts.push(
      `<revision>\nThis is a rewrite. The current version is below. Keep what the feedback does not ask to change.\nFeedback: ${input.previous.feedback || "Make it stronger."}\n\n${input.previous.content.slice(0, 40000)}\n</revision>`,
    );
  }
  return parts.join("\n\n");
}

// ── Rendering ────────────────────────────────────────────────────────────────

const cleanText = (value: string) => value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Turn the AI answer into the editable Markdown a component stores. */
export function componentMarkdown(spec: ComponentSpec, data: GeneratedComponent): string {
  const blocks: string[] = [];
  const many = data.items.length > 1;
  data.items.forEach((item, index) => {
    const title = item.title.trim();
    const heading = many ? `${spec.itemName} ${index + 1}${title ? `: ${title}` : ""}` : title || spec.itemName;
    blocks.push(`### ${heading}`);
    for (const field of item.fields) {
      const text = cleanText(field.text);
      const label = field.label.trim() || "Copy";
      if (!text) continue;
      if (text.includes("\n") || text.length > 160) blocks.push(`**${label}:**\n\n${text}`);
      else blocks.push(`**${label}:** ${text}`);
    }
  });
  if (data.notes.trim()) blocks.push(`> Note: ${cleanText(data.notes).replace(/\n/g, " ")}`);
  return blocks.join("\n\n");
}

export type MdRun = { text: string; bold: boolean };
export type MdBlock = { type: "h1" | "h2" | "h3" | "p" | "bullet" | "quote"; runs: MdRun[] };

function runs(text: string): MdRun[] {
  const out: MdRun[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length ? out : [{ text: "", bold: false }];
}

/** A small Markdown reader for the Word export: headings, bullets, quotes, paragraphs, bold. */
export function markdownBlocks(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", runs: runs(para.join("\n")) });
    para = [];
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: (`h${heading[1]!.length}` as MdBlock["type"]), runs: runs(heading[2]!) });
    } else if (/^\s*[-*]\s+/.test(line)) {
      flush();
      blocks.push({ type: "bullet", runs: runs(line.replace(/^\s*[-*]\s+/, "")) });
    } else if (/^>\s?/.test(line)) {
      flush();
      blocks.push({ type: "quote", runs: runs(line.replace(/^>\s?/, "")) });
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

/** Plain-text preview of the first item, for component cards. */
export function preview(content: string, max = 220): string {
  const text = content
    .replace(/^#{1,3}\s+.*$/gm, "")
    .replace(/^>.*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** How many items (### headings) a component's content has. */
export function itemCount(content: string): number {
  return (content.match(/^###\s+/gm) ?? []).length;
}

// ── Claims post-check ────────────────────────────────────────────────────────

export type ClaimFlag = {
  rule: string;
  phrase: string;
  excerpt: string;
  severity: "risk" | "check";
};

export type Rule = { rule: string; severity: ClaimFlag["severity"]; pattern: RegExp };

const COMMON_RULES: Rule[] = [
  { rule: "Guaranteed results", severity: "risk", pattern: /\bguarantee[sd]?\b(?:\s+\w+){0,3}?\s+(?:results?|returns?|profits?|gains?|income|success|outcomes?|to (?:work|make|earn|lose|double))\b/gi },
  { rule: "Guaranteed results", severity: "risk", pattern: /\b(?:can(?:no|')t|cannot|won'?t) (?:lose|fail|miss)\b/gi },
  { rule: "Guaranteed results", severity: "risk", pattern: /\b(?:100% (?:safe|certain|sure|guaranteed)|sure thing|zero risk|no risk whatsoever)\b/gi },
  { rule: "Risk language: confirm it refers only to the money-back guarantee", severity: "check", pattern: /\b(?:risk[- ]free|no risk)\b/gi },
  { rule: "Unsubstantiated claim: needs proof from the promo", severity: "check", pattern: /\b(?:(?:scientifically|clinically) proven|proven to|#1|number one)\b/gi },
];

const NICHE_RULES: Record<Niche, Rule[]> = {
  finance: [
    { rule: "Guaranteed returns", severity: "risk", pattern: /\b(?:double|triple) your money\b/gi },
    { rule: "Guaranteed returns", severity: "risk", pattern: /\bnever (?:lose|loses|lost) (?:money|a dime|a penny)\b/gi },
    { rule: "Guaranteed returns", severity: "risk", pattern: /\b(?:risk[- ]free|guaranteed) (?:returns?|profits?|gains?|income|investment|trades?)\b/gi },
    { rule: "Loser list", severity: "risk", pattern: /\b(?:losers?\s+list|list of (?:losers|losing \w+)|(?:biggest|worst) losers|losing (?:trades|picks|positions|stocks))\b/gi },
  ],
  health: [
    { rule: "Disease claim (diagnose, treat, cure or prevent)", severity: "risk", pattern: /\b(?:cures?|cured|curing)\b/gi },
    {
      rule: "Disease claim (diagnose, treat, cure or prevent)",
      severity: "risk",
      pattern: /\b(?:treats?|prevents?|reverses?|heals?|diagnoses?|eliminates?)\s+(?:\w+\s+){0,2}?(?:disease|cancer|diabetes|dementia|alzheimer'?s|arthritis|heart disease|depression|infection|illness|obesity)\b/gi,
    },
    { rule: "Regulatory claim: confirm it is true", severity: "risk", pattern: /\bFDA[- ]approved\b/gi },
    { rule: "Miracle claim", severity: "risk", pattern: /\b(?:miracle|magic (?:pill|bullet)|doctors hate)\b/gi },
    { rule: "Results claim: needs a typical-results disclosure", severity: "check", pattern: /\b(?:lose|lost|drop(?:ped)?)\s+\d+\s*(?:pounds|lbs|kg|inches)\b/gi },
  ],
  general: [],
};

const FIGURE = /(?:[$£€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|billion|thousand))?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|x\b)|\b\d+(?:\.\d+)?-fold\b)/gi;

const figureKey = (value: string) => value.toLowerCase().replace(/[\s,]/g, "").replace(/percent$/, "%");

function excerptAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + length + 50);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\*\*|^#{1,3}\s+/gm, "").replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A brand rule like: Never say "detox" or "clinically tested" bans those quoted phrases. */
export function quotedRules(rules: readonly string[]): Rule[] {
  const out: Rule[] = [];
  for (const rule of rules) {
    for (const m of rule.matchAll(/["“]([^"”]{2,60})["”]/g)) {
      const phrase = m[1]!.trim();
      if (phrase) out.push({ rule: `Brand rule: ${rule}`, severity: "risk", pattern: new RegExp(`\\b${escapeRe(phrase)}\\b`, "gi") });
    }
  }
  return out;
}

/**
 * Flag risky phrases in a component. Not a legal review: it points a person at
 * what to check. `allowedText` is the promo copy plus offer details; a figure
 * that appears there is from the source, anything else may be invented.
 */
export function checkClaims(content: string, input: { niche: Niche; allowedText: string; rules?: readonly string[] }): ClaimFlag[] {
  const flags: ClaimFlag[] = [];
  const seen = new Set<string>();
  const add = (flag: ClaimFlag) => {
    const key = `${flag.rule}|${flag.phrase.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push(flag);
  };
  for (const rule of [...COMMON_RULES, ...NICHE_RULES[input.niche], ...quotedRules(input.rules ?? [])]) {
    rule.pattern.lastIndex = 0;
    for (let m = rule.pattern.exec(content); m; m = rule.pattern.exec(content)) {
      add({ rule: rule.rule, phrase: m[0], excerpt: excerptAt(content, m.index, m[0].length), severity: rule.severity });
    }
  }
  const allowed = new Set<string>();
  for (const m of input.allowedText.matchAll(FIGURE)) allowed.add(figureKey(m[0]));
  for (const m of content.matchAll(FIGURE)) {
    if (allowed.has(figureKey(m[0]))) continue;
    add({ rule: "Figure not found in the promo or offer details: confirm it", phrase: m[0].trim(), excerpt: excerptAt(content, m.index ?? 0, m[0].length), severity: "check" });
  }
  // Risks first, then checks, each in reading order.
  return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "risk" ? -1 : 1));
}

// ── Context selection ────────────────────────────────────────────────────────

const STOP = new Set("the and for with that this from your you are was were have has not but all any can our out its into about what when will just more than then them they their there here who how why".split(" "));

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter((w) => !STOP.has(w));
}

/** Pick the Brain notes most related to this promo and component (simple keyword overlap). */
export function rankNotes<T extends BrainNote>(notes: readonly T[], query: string, limit: number): T[] {
  const terms = new Set(words(query));
  if (terms.size === 0) return notes.slice(0, limit);
  return notes
    .map((note, index) => {
      const title = words(note.title);
      const body = words(note.body.slice(0, 4000));
      let score = 0;
      for (const w of title) if (terms.has(w)) score += 3;
      for (const w of body) if (terms.has(w)) score += 1;
      return { note, score: score / Math.sqrt(body.length + title.length + 10), index };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.note);
}

// ── Package-level renderings ─────────────────────────────────────────────────

export type PackageComponentSummary = { kind: string; label: string; quantity: number; status: string; content: string };

export const COMPONENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  NEEDS_EDITS: "Needs edits",
  APPROVED: "Approved",
};

function directionLines(direction: PackageDirection): string[] {
  return [
    direction.angle ? `- Angle: ${direction.angle}` : "",
    direction.tone ? `- Tone: ${direction.tone}` : "",
    direction.length !== "standard" ? `- Length: ${direction.length}` : "",
    direction.offerDetails ? `- Offer details: ${direction.offerDetails.replace(/\n+/g, " ")}` : "",
    direction.notes ? `- Notes: ${direction.notes.replace(/\n+/g, " ")}` : "",
    direction.event ? `- Live event: ${direction.event.name}${direction.event.date ? ` (${direction.event.date})` : ""}` : "",
  ].filter(Boolean);
}

/** The whole package as one Markdown document. */
export function packageMarkdown(input: {
  title: string;
  promoTitle: string;
  brandName: string;
  status: string;
  direction: PackageDirection;
  components: readonly PackageComponentSummary[];
}): string {
  const lines = [`# ${input.title}`, "", `Promo: ${input.promoTitle} · Brand: ${input.brandName} · Status: ${input.status === "APPROVED" ? "Approved" : "Draft"}`];
  const direction = directionLines(input.direction);
  if (direction.length) lines.push("", "## Direction", "", ...direction);
  lines.push("", "## Contents", "", ...input.components.map((c) => `- ${c.label} (${c.quantity}) · ${COMPONENT_STATUS_LABEL[c.status] ?? c.status}`));
  for (const c of input.components) {
    lines.push("", `## ${c.label}`, "", c.content.trim() || "_Not written yet._");
  }
  return `${lines.join("\n")}\n`;
}

/** The Brain note an approved package teaches the brand's mini-brain. */
export function packageBrainNote(input: {
  title: string;
  promoTitle: string;
  brandName: string;
  direction: PackageDirection;
  components: readonly PackageComponentSummary[];
}): { title: string; body: string } {
  const lines = [
    `# Copy package: ${input.promoTitle}`,
    "",
    `Brand: ${input.brandName} · Package: ${input.title} · Approved`,
  ];
  const direction = directionLines(input.direction);
  if (direction.length) lines.push("", "## Direction that was approved", ...direction);
  lines.push("", "## Components");
  for (const c of input.components) {
    const firstHeading = /^###\s+(.*)$/m.exec(c.content)?.[1] ?? "";
    lines.push(`- **${c.label}** (${itemCount(c.content) || c.quantity})${firstHeading ? `: e.g. "${firstHeading}"` : ""}`);
  }
  const headlines = input.components.find((c) => c.kind === "alternative-headlines");
  if (headlines) {
    const picks = [...headlines.content.matchAll(/^\*\*Headline:\*\*\s*(.+)$/gm)].map((m) => m[1]!.trim()).slice(0, 5);
    if (picks.length) lines.push("", "## Approved headlines", ...picks.map((h) => `- ${h}`));
  }
  lines.push("", "Use this as a reference for what this brand approves at launch; the full copy is in Promo Analyzer.");
  return { title: `Copy package: ${input.promoTitle}`, body: lines.join("\n") };
}
