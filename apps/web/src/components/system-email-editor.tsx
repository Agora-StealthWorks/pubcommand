"use client";

import {
  renderSystemEmail,
  SYSTEM_EMAIL_LIMITS,
  systemEmailCopyProblem,
  type SystemEmailCopy,
  type SystemEmailDefinition,
  type SystemEmailKey,
} from "@pubcommand/core";
import { Button } from "@pubcommand/ui";
import { useMemo, useState } from "react";

type FormAction = (formData: FormData) => void | Promise<void>;

/**
 * Admin → Emails: one system email's copy on the left, a live preview on the right.
 * The preview renders with the same function as real sends (renderSystemEmail), with sample
 * values for the placeholders, so what you see is what goes out.
 */
export function SystemEmailEditor({
  emailKey,
  definition,
  saved,
  edited,
  origin,
  canEdit,
  actions,
}: {
  emailKey: SystemEmailKey;
  definition: SystemEmailDefinition;
  /** The copy that goes out today (defaults merged with saved edits). */
  saved: SystemEmailCopy;
  /** True when staff have saved edits for this email. */
  edited: boolean;
  origin: string;
  canEdit: boolean;
  actions: { save: FormAction; reset: FormAction; test: FormAction };
}) {
  const [copy, setCopy] = useState<SystemEmailCopy>(saved);
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const dirty = (Object.keys(copy) as (keyof SystemEmailCopy)[]).some((field) => copy[field] !== saved[field]);
  const problem = systemEmailCopyProblem(emailKey, copy);
  const preview = useMemo(
    () => renderSystemEmail(emailKey, { link: `${origin}/login`, origin, values: definition.sample, overrides: { [emailKey]: copy } }),
    [emailKey, origin, definition.sample, copy],
  );
  const set = (field: keyof SystemEmailCopy) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setCopy((current) => ({ ...current, [field]: event.target.value }));
  const placeholders = Object.entries(definition.placeholders);
  const inputClass = "mt-1 block w-full min-h-11 rounded-md border border-line bg-white px-3 text-base text-ink sm:text-sm";

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section className="min-w-0 rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{definition.name}</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${edited ? "bg-[#f4f3ff] text-[#5925dc]" : "bg-canvas text-muted"}`}>
            {edited ? "Edited copy" : "Default copy"}
          </span>
          {dirty ? <span className="rounded-full bg-[#fffaeb] px-2 py-0.5 text-xs font-medium text-[#b54708]">Unsaved changes</span> : null}
        </div>
        <p className="mt-1 text-sm text-muted">Sent when: {definition.when}</p>

        <form action={actions.save} className="mt-4 space-y-4">
          <input type="hidden" name="key" value={emailKey} />
          <fieldset disabled={!canEdit} className="space-y-4">
            <label className="block text-sm font-medium">
              Subject
              <input name="subject" value={copy.subject} onChange={set("subject")} maxLength={SYSTEM_EMAIL_LIMITS.subject} className={inputClass} />
            </label>
            <label className="block text-sm font-medium">
              Heading
              <input name="heading" value={copy.heading} onChange={set("heading")} maxLength={SYSTEM_EMAIL_LIMITS.heading} className={inputClass} />
            </label>
            <label className="block text-sm font-medium">
              Body
              <span className="block text-xs font-normal text-muted">Leave a blank line between paragraphs.</span>
              <textarea
                name="body"
                value={copy.body}
                onChange={set("body")}
                rows={9}
                maxLength={SYSTEM_EMAIL_LIMITS.body}
                className="mt-1 block w-full rounded-md border border-line bg-white px-3 py-2 text-base leading-6 text-ink sm:text-sm"
              />
            </label>
            <label className="block text-sm font-medium">
              Button label
              <input name="buttonLabel" value={copy.buttonLabel} onChange={set("buttonLabel")} maxLength={SYSTEM_EMAIL_LIMITS.buttonLabel} className={inputClass} />
            </label>
            <label className="block text-sm font-medium">
              Footnote <span className="font-normal text-muted">(optional, small grey text)</span>
              <input name="footnote" value={copy.footnote} onChange={set("footnote")} maxLength={SYSTEM_EMAIL_LIMITS.footnote} className={inputClass} />
            </label>
          </fieldset>

          <div className="rounded-md bg-canvas px-3 py-2 text-xs text-muted">
            {placeholders.length ? (
              <>
                Placeholders:{" "}
                {placeholders.map(([name, description], index) => (
                  <span key={name}>
                    {index ? ", " : ""}
                    <code className="font-semibold text-ink">{`{${name}}`}</code> {description.toLowerCase()} (preview: {definition.sample[name]})
                  </span>
                ))}
                .
              </>
            ) : (
              "This email has no placeholders."
            )}{" "}
            The button always carries the person&apos;s own secure link, which you can&apos;t edit.
          </div>

          {problem ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{problem}</p> : null}

          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={Boolean(problem) || !dirty} className="w-full sm:w-auto">
                Save
              </Button>
              <Button type="submit" formAction={actions.test} variant="secondary" disabled={Boolean(problem)} className="w-full sm:w-auto">
                Send a test to me
              </Button>
              {dirty ? (
                <button type="button" onClick={() => setCopy(saved)} className="min-h-11 w-full rounded-md px-3 text-sm font-medium text-muted hover:text-ink sm:w-auto">
                  Discard changes
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">Only super admins can edit these emails.</p>
          )}
        </form>

        {canEdit && edited ? (
          <form action={actions.reset} className="mt-3 border-t border-line pt-3">
            <input type="hidden" name="key" value={emailKey} />
            <button type="submit" className="min-h-11 text-sm font-medium text-[#b42318] hover:underline">
              Reset to the default copy
            </button>
          </form>
        ) : null}
      </section>

      <section className="min-w-0 rounded-lg border border-line bg-white" aria-label="Preview">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted">Preview{dirty ? " (unsaved)" : ""}</p>
            <p className="pc-break text-sm">
              <span className="text-muted">From </span>PubCommand <span className="text-muted">· Subject </span>
              <b>{preview.subject}</b>
            </p>
          </div>
          <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Preview width">
            {(["desktop", "phone"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={width === option}
                onClick={() => setWidth(option)}
                className={`min-h-9 rounded px-3 text-sm font-medium capitalize ${width === option ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto bg-canvas p-3">
          <iframe
            title={`${definition.name} preview`}
            srcDoc={preview.html}
            sandbox=""
            className="mx-auto block h-[640px] rounded-md border border-line bg-white"
            style={{ width: width === "phone" ? 375 : "100%", maxWidth: "100%" }}
          />
        </div>
        <details className="border-t border-line px-4 py-3 text-sm">
          <summary className="min-h-9 cursor-pointer font-medium">Plain-text version</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-canvas p-3 font-mono text-xs leading-5 text-ink">{preview.text}</pre>
        </details>
      </section>
    </div>
  );
}
