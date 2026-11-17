# Research Extractor

Route: `/research`. Permissions: `research.read`, `research.write`. Plan entitlement: `research`.

A research organizer for copywriters built on the index-card method. Writers drop in sources, the AI writes 5 to 15 index cards per source (topic, summary, detail, and the exact facts and quotes with their location), cards are sorted into topic groups, and an outline of sections and bullets is built by placing cards on bullets. It organizes research; it does not write copy.

## Pure logic (this folder, unit tested)

- `ingest.ts`: the SSRF URL check (`checkFetchUrl`, `isBlockedAddress` for IPv4/IPv6 private, loopback, link-local, CGNAT, multicast, mapped and NAT64 forms), HTML to readable text, YouTube id and caption parsing, text normalization.
- `extract.ts`: the card and grouping prompts, JSON schemas, clean-up (`normalizeExtraction`), truncation message, grouping mapping, and the opt-in Brain note.
- `outline.ts`: reorder and card-placement operations and `positionChanges` (only changed rows are written).
- `export.ts`: one block list for Markdown and Word (`exportBlocks`, `outlineMarkdown`).
- `access.ts`: project access (owner, admin, edit, view, none).

## Server (`apps/web/src/features/research/`)

- `fetch.ts`: `safeFetch` checks every hop (redirects included) and resolves DNS inside the socket connect, refusing private answers, so a hostname cannot rebind to an internal address between check and connect.
- `ingest.ts`: paste, URL (HTML or PDF), PDF/DOCX/TXT upload (`unpdf`, `mammoth`; PDFs with no text layer go to the AI as a document, up to 20 MB), YouTube (pasted transcript, else public captions, else ask for a transcript).
- `server.ts`: background extraction and grouping (`after()`, status columns polled by the page), AI usage logging, Brain note refresh.
- `actions.ts`, `outline-actions.ts`: every action re-checks entitlement, permission and project access.

## Access

- Projects belong to the current brand and are private to their owner.
- Workspace admins (anyone with `settings.manage`) see and manage every project in the brand.
- Shares are keyed by email (view or edit), so a project can be shared before the teammate first signs in. Edit also needs `research.write`.
- Shares, the public link and the Brain toggle are shown only to the owner and admins.
- The public read-only page is `/p/research/<token>` (`apps/web/src/app/sites/public/[slug]/research/[token]`). It shows the outline and cards, never source text or files. Regenerating the link kills the old one.

## Brain

Off by default (the old app was fully private by design). The per-project toggle "Share cards with the Brain" keeps one note (`sourceRef research-project:<id>`, folder "Research") in the brand's mini-brain current after each extraction, grouping and card edit. Turning it off, or deleting the project, removes that note.
