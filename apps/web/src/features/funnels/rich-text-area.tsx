"use client";

import { useRef, useState } from "react";
import { uploadFunnelImage } from "./site-actions";

/**
 * A textarea for rich text with a small toolbar: bold, italic, heading, list,
 * link and image upload. It writes simple HTML; the server sanitizes it on save
 * and again on render. Works controlled (value/onChange) or inside a plain form
 * (name/defaultValue).
 */
export function RichTextArea({
  funnelId,
  id,
  name,
  value,
  defaultValue,
  onChange,
  rows = 6,
  images = true,
}: {
  funnelId: string;
  id: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  rows?: number;
  images?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: string, caret: number) => {
    const element = area.current;
    if (!element) return;
    if (onChange) onChange(next);
    else element.value = next;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  };

  const wrap = (before: string, after: string, placeholder: string) => {
    const element = area.current;
    if (!element) return;
    const { selectionStart: start, selectionEnd: end, value: current } = element;
    const selected = current.slice(start, end) || placeholder;
    const next = `${current.slice(0, start)}${before}${selected}${after}${current.slice(end)}`;
    apply(next, start + before.length + selected.length + after.length);
  };

  const insert = (snippet: string) => {
    const element = area.current;
    if (!element) return;
    const { selectionStart: start, selectionEnd: end, value: current } = element;
    apply(`${current.slice(0, start)}${snippet}${current.slice(end)}`, start + snippet.length);
  };

  const link = () => {
    const href = window.prompt("Link address (https://…)", "https://");
    if (!href || !/^(https?:\/\/|mailto:)/i.test(href)) return;
    wrap(`<a href="${href.replace(/"/g, "%22")}">`, "</a>", "link text");
  };

  const upload = async (chosen: File | undefined) => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("funnelId", funnelId);
    body.set("kind", "block");
    body.set("file", chosen);
    const result = await uploadFunnelImage(body);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else insert(`\n<p><img src="${result.src}" alt=""></p>\n`);
  };

  const button = "inline-flex min-h-9 min-w-9 items-center justify-center rounded border border-line bg-white px-2 text-xs font-semibold hover:bg-canvas disabled:opacity-50";
  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap gap-1" role="toolbar" aria-label="Formatting">
        <button type="button" className={button} onClick={() => wrap("<strong>", "</strong>", "bold text")} aria-label="Bold">
          <b>B</b>
        </button>
        <button type="button" className={button} onClick={() => wrap("<em>", "</em>", "italic text")} aria-label="Italic">
          <i>I</i>
        </button>
        <button type="button" className={button} onClick={() => wrap("<h2>", "</h2>", "Heading")}>
          H2
        </button>
        <button type="button" className={button} onClick={() => wrap("<h3>", "</h3>", "Subheading")}>
          H3
        </button>
        <button type="button" className={button} onClick={() => insert("\n<ul>\n<li>First point</li>\n<li>Second point</li>\n</ul>\n")}>
          • List
        </button>
        <button type="button" className={button} onClick={link}>
          Link
        </button>
        {images ? (
          <>
            <button type="button" className={button} disabled={busy} onClick={() => file.current?.click()}>
              {busy ? "Uploading…" : "Image"}
            </button>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                void upload(chosen);
              }}
            />
          </>
        ) : null}
      </div>
      <textarea
        ref={area}
        id={id}
        name={name}
        rows={rows}
        {...(onChange ? { value: value ?? "", onChange: (event) => onChange(event.target.value) } : { defaultValue })}
        className="block w-full min-w-0 rounded-md border border-line bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-ink"
        spellCheck
      />
      {error ? <p className="mt-1 text-xs text-[#912018]">{error}</p> : <p className="mt-1 text-xs text-muted">Plain text or simple HTML. Paragraphs, bold, links, lists and images are kept; anything else is removed.</p>}
    </div>
  );
}
