# Promo Analyzer (`promo-studio`)

Route: `/promo-studio`. Permissions: `promo.read`, `promo.write`. Plan entitlement: `promo-studio`.

Rebuilt to work like the OxfordHub Promo Analyzer: one promo in, one streamed review out, watched live, scored in code. Multi-brand: the reader, niche and compliance rules come from the brand profile, and the directory is the brand's Publication Setup.

## The analysis pipeline

1. **Upload** (`features/promos/actions.ts#createPromo`): a .docx, .pdf, .txt or pasted copy, plus an optional approximate run start date and promo code. The text is extracted (`extractSource`); the original file is kept in `promo_files`. The promo goes to `QUEUED` and the run starts with `after()`, so the request returns at once.
2. **Context** (`features/promos/server.ts#gatherContext`), all sent as a second system block after the cached instructions:
   - the brand and its reader (`brandPromptContext`), never a hardcoded avatar;
   - the brand's publications and editors from Publication Setup;
   - **attribution directive**: `matchDirectory` (prompt.ts) finds editors and publications named in the copy (whole-word names, codes only in brackets) before the call, and the model is told the publisher is the brand. Afterwards `detectedFrom` (stored.ts) uses the code match over the model's guess;
   - the matched publication's prompt block and the matched editors' profiles (bio, credentials, track record);
   - **calibration**: this brand's promos with a person's training (your score, real-world score, notes, best performer). Best performers and real-world 9+ are always included as anchors; the rest are ranked by same editor, same type, same publication or product, and capped at 12 (`pickCalibration`). Imported results percentiles are not used here, only scores people entered;
   - **lessons** from the Lessons page (pinned first, then the most relevant), and up to three related notes from the brand's Brain;
   - the **input modality**: PDFs are sent as documents and read visually; Word and pasted copy are words only, and the model is told not to credit or penalise design it cannot see.
3. **One streamed answer** (`streamText` in `@pubcommand/ai`: `claude-opus-5-5`, effort high, server-side fallbacks, cached system prompt, never throws). No JSON schema. The answer is eight labelled sections, in order, each between `<<KEY>>` and `<</KEY>>` (`sections.ts`):
   `HEADLINE` (eyebrow, headline, subhead; the 4 U's judged on the headline block only as present / weak / absent; verdict) ·
   `OUTLINE` (sections in order, the first is "The Lead", one-line purpose each) ·
   `SIXTEEN_WORD` (Q1-Q10 and close steps C1-C8 as Strong / Present but weak / Missing with why; testimonials count least; verdict) ·
   `CUB` (raw JSON array of flagged lines: text, confusing | unbelievable | boring, reason) ·
   `OFFER` (big idea, publisher with the attribution rule, product, what it is, prices, payment options, premiums, guarantee, urgency) ·
   `TEASE` (what the promo teases without naming: a stock, an ingredient, a protocol...; clues, guesses, confidence; or NONE) ·
   `INTEL` (raw JSON of facts the promo states about its expert, product, publication, strategies, topics, beliefs, proof; knowledge, not judgement) ·
   `SCORECARD` (8 dimensions 1-10 with positive one-line rationales, an optional `Adjustment: ±x`, and a rationale).
   Rules in every section: ignore placeholders and production marks, tiered pricing is not an unclear offer, score conversion for this reader not textbook compliance, compare with the proven winners in the context.
4. **Live view**: while it streams, the server writes the answer so far to `promos.analysis_live` about once a second. The promo page shows `LiveAnalysis` (client), which polls `/promo-studio/<id>/live`, cuts the text into sections with the same `splitSections`, and shows the progress bar, the section being written as it appears, and each finished section formatted in its tab. The run belongs to the server: closing the tab or losing the connection changes nothing, and the page picks it up again on reload.
5. **Save** (`buildStored`, stored.ts): a new `promo_analyses` version with `result = { format: "sections", version: 2, raw, sections, incomplete, truncated, visual, matches, scorecard }`. Sections are parsed on read (`parse.ts`), so parser fixes reach old rows.
   - Refusal → `FAILED` with "The AI declined…", the previous analysis stays.
   - `max_tokens` → the run is saved as an **incomplete** version (finished sections kept, the rest listed). It never replaces a complete review: `currentAnalysis` (stored.ts) picks the newest complete version, so the promo keeps its previous review and score, the page says the latest run stopped early and offers Re-analyze, and History shows the incomplete version with what it finished. With no earlier review, the partial one is shown with no score.
   - No sections at all → `FAILED`.
6. **Score** (`score.ts`): the final score is computed in code: weighted blend of the 8 dimensions (Hook Strength 1.6, Believability 1.5, Specificity 0.8, Emotional Pull 1.4, Momentum 0.9, Offer Clarity 1.0, Call to Action / Urgency 0.9, Audience Fit 1.3; the publisher's weights from the OxfordHub analyzer) plus the AI's adjustment clamped to ±1, clamped to 1-10, one decimal. With fewer than 8 dimensions the observed weight is used. Reading ease and grade are computed locally (`readability`).
7. **Brain** (`teachAnalysis`): three notes in the brand's Brain through `teachBrain()` with stable `sourceRef`s: the review (`promo:<id>`, folder "Promo reviews"), the promo's facts from `INTEL` (`promo-intel:<id>`, "Promo facts"), and the promo's own copy (`promo-copy:<id>`, "Promo copy").

Bulk re-analyze (`bulk-queue.ts` + `insights.ts#runBulkJob`) calls the same `runPromoAnalysis`.

## Re-evaluate (training loop)

On the Training tab, after saving your score and/or the real-world score, **Re-evaluate** asks the AI (`REEVALUATE_SYSTEM`) to re-score all eight dimensions in light of the feedback (strong-signal wording for best performers or 9+). The proposal is saved on the analysis (`reevaluation`) and shown with Apply / Discard. Applying stores it as `calibrated`; the shown scorecard and `promos.effectiveness_score` then come from it. `promo_analyses.score` keeps the first prediction, which the calibration chart uses. A re-analysis starts a new version without the calibration.

## Old analyses

Analyses saved before November 2026 are one JSON object (`PromoAnalysisResult` in analysis.ts). They still render with their own tabs and export. Everything downstream reads `analysisDigest(result)` (stored.ts), which gives one shape for both versions: headline, big idea, offer, the 8 scores under the `SUB_SCORES` names (similar-promo matching), strengths and fixes (lesson clustering), cub count, detected publisher, editor, product and price.

## Files

| File | What |
| --- | --- |
| `analysis.ts` | Promo types and statuses, the 16-Word questions and close steps, `readability`, `readingEaseLabel`, `promoTypeFromPrice`, `locateCub`, the v1 type. |
| `sections.ts` | Section keys, labels, `splitSections` (full or half-written answers), progress. |
| `prompt.ts` | `ANALYSIS_SYSTEM`, `analysisContext`, `matchDirectory`, `directiveBlock`, calibration and lessons blocks, re-evaluation prompt. |
| `parse.ts` | Forgiving parsers for every section; broken CUB or INTEL JSON gives null (complete CUB items are salvaged), never an exception. |
| `score.ts` | Dimensions, weights, `parseScorecard`, `finalScore`. |
| `stored.ts` | Saved shape, `analysisDigest`, Markdown, Brain notes. |
| `fixtures.ts` | A realistic sample answer, used by tests and the local fake AI. |

Exports: `/promo-studio/<id>/export` (Word, with the copy annotated by CUB flag) and `?format=md` (Markdown).

## Testing without an API key

`pnpm test` covers the parsers (including malformed and missing sections), scoring, attribution, calibration and the stored shape; `packages/ai/src/stream.test.ts` covers `streamText` against a local SSE server (stream, refusal, max_tokens, no key). For the browser, run a fake Messages API that streams `SAMPLE_ANSWER` slowly and start the dev server with `ANTHROPIC_API_KEY=anything ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`.

## Other parts of this module

`packager.ts` (copy package), `training.ts` (the Packager's example library), `lessons.ts` (lesson themes), `performance.ts`, `imports.ts`, `sheets.ts` (results), `similar.ts` (similar-promo outcomes), `entities.ts` (Directory overrides), `queue.ts` (bulk queue), `timely.ts` (timely hooks).
