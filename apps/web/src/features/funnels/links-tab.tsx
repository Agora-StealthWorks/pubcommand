"use client";

import { useMemo, useState } from "react";

/**
 * The builder's Links tab. PubCommand does not email anyone for a funnel: the
 * team copies these links (with the org's tracked parameters filled in) into
 * their own email tool, as a plain link, a text link or a ready-made button.
 */
export type FunnelLink = { id: string; label: string; detail?: string; url: string; keyUrl?: string | null };

function withParams(raw: string, params: Record<string, string>): string {
  try {
    const url = new URL(raw);
    for (const [key, value] of Object.entries(params)) if (value.trim()) url.searchParams.set(key, value.trim());
    return url.toString();
  } catch {
    return raw;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function contrast(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

export function linkHtml(kind: "text" | "button", url: string, text: string, color: string): string {
  const href = escapeHtml(url);
  const label = escapeHtml(text);
  if (kind === "text") return `<a href="${href}" style="color:${color};font-weight:bold;">${label}</a>`;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:6px;background:${color};"><a href="${href}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:${contrast(color)};text-decoration:none;border-radius:6px;">${label}</a></td></tr></table>`;
}

async function copy(plain: string, html?: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    return true;
  } catch {
    return false;
  }
}

const small = "inline-flex min-h-9 items-center whitespace-nowrap rounded-md border border-line bg-white px-2.5 text-xs font-semibold hover:bg-canvas";

export function LinksTab({ links, trackedParams, defaults, accent, keyLinks }: { links: FunnelLink[]; trackedParams: string[]; defaults: Record<string, string>; accent: string; keyLinks: boolean }) {
  const [params, setParams] = useState<Record<string, string>>(() => Object.fromEntries(trackedParams.map((key) => [key, defaults[key] ?? ""])));
  const [useKeys, setUseKeys] = useState(keyLinks);
  const [color, setColor] = useState(/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#1d4ed8");
  const [buttonText, setButtonText] = useState("Watch now");
  const [copied, setCopied] = useState<string | null>(null);

  const rows = useMemo(() => links.map((link) => ({ ...link, final: withParams(useKeys && link.keyUrl ? link.keyUrl : link.url, params) })), [links, params, useKeys]);

  const flash = async (id: string, plain: string, html?: string) => {
    const ok = await copy(plain, html);
    setCopied(ok ? id : `${id}:fail`);
    window.setTimeout(() => setCopied((current) => (current?.startsWith(id) ? null : current)), 1800);
  };
  const label = (id: string, text: string) => (copied === id ? "Copied ✓" : copied === `${id}:fail` ? "Copy failed" : text);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-base font-semibold">Links for your emails</h2>
        <p className="mt-1 text-sm text-muted">
          PubCommand doesn&apos;t send invites or reminders for funnels. Copy these links into your own email tool. Each one carries the tracking values below, so Stats can show which email brought people in.
        </p>
        {trackedParams.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trackedParams.map((key) => (
              <label key={key} className="block text-sm">
                <span className="font-semibold">{key}</span>
                <input className="pc-control mt-1 w-full" value={params[key] ?? ""} onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.value }))} placeholder="(leave empty to skip)" maxLength={200} />
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Your organization tracks no URL parameters (Funnels → Settings), so links are copied as they are.</p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block text-sm">
            <span className="font-semibold">Button text</span>
            <input className="pc-control mt-1 w-full" value={buttonText} onChange={(event) => setButtonText(event.target.value)} maxLength={80} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-semibold">Button colour</span>
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-9 w-12 cursor-pointer rounded border border-line" aria-label="Button colour" />
          </label>
        </div>
        {keyLinks ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useKeys} onChange={(event) => setUseKeys(event.target.checked)} />
            Module links unlock their module (they carry the module&apos;s link key)
          </label>
        ) : null}
      </section>

      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{row.label}</p>
                {row.detail ? <p className="text-xs text-muted">{row.detail}</p> : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={small} onClick={() => flash(`${row.id}:url`, row.final)}>
                  {label(`${row.id}:url`, "Copy link")}
                </button>
                <button type="button" className={small} onClick={() => flash(`${row.id}:text`, row.final, linkHtml("text", row.final, row.label, color))}>
                  {label(`${row.id}:text`, "Copy text link")}
                </button>
                <button type="button" className={small} onClick={() => flash(`${row.id}:button`, row.final, linkHtml("button", row.final, buttonText || row.label, color))}>
                  {label(`${row.id}:button`, "Copy button")}
                </button>
                <button type="button" className={small} onClick={() => flash(`${row.id}:html`, linkHtml("button", row.final, buttonText || row.label, color))}>
                  {label(`${row.id}:html`, "Copy button HTML")}
                </button>
              </div>
            </div>
            <input readOnly value={row.final} onFocus={(event) => event.target.select()} className="pc-control mt-2 w-full font-mono text-xs" aria-label={`${row.label} link`} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        “Copy text link” and “Copy button” paste as a formatted link or button into editors like Gmail, Iterable or Mailchimp. Use “Copy button HTML” for an HTML or code block.
      </p>
    </div>
  );
}
