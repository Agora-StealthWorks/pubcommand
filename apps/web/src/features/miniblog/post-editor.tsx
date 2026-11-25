"use client";

import { Input, Textarea } from "@pubcommand/ui";
import { useRef, useState } from "react";
import { CONTENT_AD_SHORTCODE, adChoiceOptions, hasContentAd, parseAdChoice, splitAtContentAd, stripContentAd, type AdCode } from "../../../../../modules/miniblog/ads";
import { AdPlaceholder, BlogHeader, LookRoot, PostArticle, TextAd, type Look } from "./article";
import { Field, Section } from "./fields";
import { MiniBlogRichText } from "./rich-text";

type AdSummary = Pick<AdCode, "id" | "name" | "network">;

export type PostEditorValues = {
  title: string;
  slug: string;
  publishAt: string;
  category: string;
  tickers: string;
  bodyHtml: string;
  topAd: string;
  topAdText: string;
  topAdLink: string;
  contentAd: string;
  contentAdText: string;
  contentAdLink: string;
  actionToTake: string;
  actionSecondary: string;
  buttonText: string;
  buttonUrl: string;
};

/** The live preview runs in the author's own browser; still drop script and event handlers from HTML typed in the HTML view. */
function previewSafe(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|object|embed|form)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

function formatPreviewDate(local: string): string {
  const date = local ? new Date(`${local}:00`) : new Date();
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function ZonePreview({ choice, text, link, codes }: { choice: string; text: string; link: string; codes: readonly AdSummary[] }) {
  const parsed = parseAdChoice(choice);
  if (parsed.kind === "text") return text.trim() ? <TextAd text={text.trim()} href={link.trim() ? "#" : null} /> : null;
  if (parsed.kind === "code") {
    const code = codes.find((item) => item.id === parsed.id);
    return code ? <AdPlaceholder label={`${code.name} (runs on the public page only)`} /> : null;
  }
  return null;
}

function AdZoneFields({ prefix, label, value, current, codes, hint, disabled }: { prefix: "topAd" | "contentAd"; label: string; value: { choice: string; text: string; link: string }; current: string; codes: readonly AdSummary[]; hint: string; disabled?: boolean }) {
  const kind = parseAdChoice(current).kind;
  return (
    <div className="space-y-3">
      <Field label={label} htmlFor={prefix} hint={hint}>
        <select id={prefix} name={prefix} defaultValue={value.choice} disabled={disabled} className="pc-control w-full text-sm">
          {adChoiceOptions(codes as AdCode[]).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <div className={`grid gap-3 sm:grid-cols-2 ${kind === "text" ? "" : "hidden"}`}>
        <Field label="Ad text" htmlFor={`${prefix}Text`} hint="Two short lines work best.">
          <Textarea id={`${prefix}Text`} name={`${prefix}Text`} defaultValue={value.text} className="min-h-16" maxLength={400} />
        </Field>
        <Field label="Ad link (optional)" htmlFor={`${prefix}Link`} hint="Clicks are counted as ad clicks.">
          <Input id={`${prefix}Link`} name={`${prefix}Link`} type="url" defaultValue={value.link} placeholder="https://" />
        </Field>
      </div>
    </div>
  );
}

/**
 * The post editor: every T-Letter field (title, link name, publish time, internal
 * category and tickers, body with a [content ad] button, top and content ad
 * zones, action box with secondary line and button) and a live preview of the
 * public page in the Mini-Blog's look.
 */
export function PostEditorForm({
  action,
  siteId,
  postId,
  siteSlug,
  initial,
  look,
  logoSrc,
  siteName,
  categories,
  adCodes,
  zoneLabel,
  canWrite,
  buttons,
}: {
  action: (formData: FormData) => void | Promise<void>;
  siteId: string;
  postId: string;
  siteSlug: string;
  initial: PostEditorValues;
  look: Look;
  logoSrc: string | null;
  siteName: string;
  categories: string[];
  adCodes: AdSummary[];
  zoneLabel: string;
  canWrite: boolean;
  buttons: React.ReactNode;
}) {
  const [values, setValues] = useState(initial);
  const form = useRef<HTMLFormElement>(null);
  const read = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    setValues((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(prev) as (keyof PostEditorValues)[]) {
        if (key === "bodyHtml") continue;
        const value = data.get(key);
        if (typeof value === "string") next[key] = value;
      }
      return next;
    });
  };

  const body = previewSafe(values.bodyHtml);
  const contentChoice = parseAdChoice(values.contentAd).kind !== "none";
  const { before, after } = contentChoice ? splitAtContentAd(body) : { before: stripContentAd(body), after: null };
  const shortcodeMissing = contentChoice && !hasContentAd(values.bodyHtml);
  const shortcodeUnused = !contentChoice && hasContentAd(values.bodyHtml);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
      <form ref={form} action={action} onChange={read} onInput={read} className="min-w-0 space-y-4">
        <input type="hidden" name="siteId" value={siteId} />
        <input type="hidden" name="postId" value={postId} />
        <fieldset disabled={!canWrite} className="space-y-4">
          <Section title="Post">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="title" className="sm:col-span-2">
                <Input id="title" name="title" defaultValue={initial.title} maxLength={200} required />
              </Field>
              <Field label="Link name" htmlFor="slug" hint={`/b/${siteSlug}/${values.slug || initial.slug}`}>
                <Input id="slug" name="slug" defaultValue={initial.slug} maxLength={80} pattern="[a-z0-9-]+" />
              </Field>
              <Field label={`Publish time (${zoneLabel})`} htmlFor="publishAt" hint="A future time schedules the post; it stays hidden until then. The Calendar issue goes on this date.">
                <Input id="publishAt" name="publishAt" type="datetime-local" defaultValue={initial.publishAt} required />
              </Field>
              <Field label="Category (internal)" htmlFor="category" hint={categories.length ? "Never shown on the public page." : "Add categories in Settings to tag posts."}>
                <select id="category" name="category" defaultValue={initial.category} className="pc-control w-full text-sm" disabled={!categories.length}>
                  <option value="">None</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ticker(s) (internal)" htmlFor="tickers" hint="e.g. NVDA or NVDA, AMD. Copied to the Calendar issue; never public.">
                <Input id="tickers" name="tickers" defaultValue={initial.tickers} maxLength={120} className="font-mono uppercase" />
              </Field>
            </div>
            <Field
              label="Body"
              htmlFor="bodyHtml"
              hint={
                <>
                  Links are tracked: each one counts clicks for this post. Use <strong>Content ad</strong> in the toolbar to place the {CONTENT_AD_SHORTCODE} zone.
                </>
              }
            >
              <MiniBlogRichText
                siteId={siteId}
                id="bodyHtml"
                name="bodyHtml"
                defaultValue={initial.bodyHtml}
                disabled={!canWrite}
                onChange={(html) => setValues((prev) => ({ ...prev, bodyHtml: html }))}
                inserts={[{ label: "+ Content ad", text: CONTENT_AD_SHORTCODE, title: "Insert the [content ad] zone here" }]}
              />
            </Field>
          </Section>

          <Section title="Ads" description="The top ad shows above the post. The content ad fills the [content ad] spot in the body. Ad network codes are set in this Mini-Blog's Ads tab.">
            <AdZoneFields prefix="topAd" label="Top ad" value={{ choice: initial.topAd, text: initial.topAdText, link: initial.topAdLink }} current={values.topAd} codes={adCodes} hint="Text ad = the light-grey T-Letter box." disabled={!canWrite} />
            <AdZoneFields prefix="contentAd" label="Content ad" value={{ choice: initial.contentAd, text: initial.contentAdText, link: initial.contentAdLink }} current={values.contentAd} codes={adCodes} hint={`Fills ${CONTENT_AD_SHORTCODE} in the body.`} disabled={!canWrite} />
            {shortcodeMissing ? <p className="text-xs font-semibold text-[#b54708]">A content ad is picked but the body has no {CONTENT_AD_SHORTCODE}. Click “+ Content ad” in the toolbar where it should go.</p> : null}
            {shortcodeUnused ? <p className="text-xs text-muted">The body has {CONTENT_AD_SHORTCODE} but no content ad is picked, so nothing shows there.</p> : null}
          </Section>

          <Section title="Action to take box" description="Leave it empty to hide the box. The button shows only with both text and a link.">
            <Field label="Action to take" htmlFor="actionToTake">
              <Textarea id="actionToTake" name="actionToTake" defaultValue={initial.actionToTake} className="min-h-16" placeholder="e.g. Buy XYZ under $50." />
            </Field>
            <Field label="Secondary line (optional)" htmlFor="actionSecondary" hint="Small italic line under the action.">
              <Input id="actionSecondary" name="actionSecondary" defaultValue={initial.actionSecondary} maxLength={300} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button text" htmlFor="buttonText">
                <Input id="buttonText" name="buttonText" defaultValue={initial.buttonText} maxLength={60} />
              </Field>
              <Field label="Button link" htmlFor="buttonUrl">
                <Input id="buttonUrl" name="buttonUrl" type="url" defaultValue={initial.buttonUrl} placeholder="https://" />
              </Field>
            </div>
          </Section>
          {buttons}
        </fieldset>
      </form>

      <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start" aria-label="Live preview">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Live preview</p>
        <div className="max-h-[80vh] overflow-auto rounded-xl border border-line shadow-sm">
          <LookRoot look={look}>
            <BlogHeader look={look} logoSrc={logoSrc} name={siteName} href={null} />
            <div className="mb-wrap">
              <div className="mb-stack">
                <ZonePreview choice={values.topAd} text={values.topAdText} link={values.topAdLink} codes={adCodes} />
                <PostArticle
                  look={look}
                  date={formatPreviewDate(values.publishAt)}
                  title={values.title}
                  bodyBefore={before}
                  bodyAfter={after}
                  contentAd={<ZonePreview choice={values.contentAd} text={values.contentAdText} link={values.contentAdLink} codes={adCodes} />}
                  actionToTake={values.actionToTake || null}
                  actionSecondary={values.actionSecondary || null}
                  button={values.buttonText.trim() && values.buttonUrl.trim() ? { text: values.buttonText, href: "#" } : null}
                />
              </div>
            </div>
          </LookRoot>
        </div>
        <p className="mt-2 text-xs text-muted">Links do not count clicks here. Ad network codes show as a placeholder; they run on the public page.</p>
      </aside>
    </div>
  );
}
