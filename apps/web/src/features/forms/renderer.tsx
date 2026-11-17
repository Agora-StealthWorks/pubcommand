"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ADDRESS_PARTS, OTHER_PREFIX, fieldSpec, type AddressValue, type SignatureValue } from "../../../../../modules/forms/fields";
import { nextOnPath, pageErrors, previousOnPath, progressPercent, resolveForm } from "../../../../../modules/forms/logic";
import { captureUtm, contrastText, disclaimerText, hiddenValues } from "../../../../../modules/forms/theme";
import type { AnswerMap, FieldDef, PublicForm, ResolvedTheme } from "../../../../../modules/forms/types";

export type RendererMode = "public" | "embed" | "preview";

const AUTO_ADVANCE_TYPES = new Set(["single_choice", "yes_no", "rating", "nps", "scale"]);

export function FormHeader({ theme }: { theme: ResolvedTheme }) {
  const ink = contrastText(theme.barColor);
  const pad = Math.round(Math.max(10, theme.logoHeight * 0.3));
  return (
    <header style={{ background: theme.barColor, paddingTop: pad, paddingBottom: pad }} className="px-4">
      <div className="mx-auto flex max-w-xl items-center" style={{ minHeight: theme.logoHeight }}>
        {theme.logoSrc ? (
          <img src={theme.logoSrc} alt={theme.brandName} style={{ height: theme.logoHeight, maxWidth: "100%" }} className="block w-auto object-contain" />
        ) : (
          <span style={{ color: ink }} className="[overflow-wrap:anywhere] text-lg font-semibold tracking-tight">
            {theme.brandName}
          </span>
        )}
      </div>
    </header>
  );
}

export function Disclaimer({ form, theme }: { form: PublicForm; theme: ResolvedTheme }) {
  return (
    <p className="mt-5 text-[11px] leading-relaxed text-[#5b6577]">
      {disclaimerText(form.disclaimer, theme.companyName, form.fields)}{" "}
      {/* The privacy-policy link is always shown. A form cannot be published without one. */}
      {theme.privacyPolicyUrl ? (
        <a href={theme.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="underline">
          Privacy policy
        </a>
      ) : (
        <span>Privacy policy link not set.</span>
      )}
    </p>
  );
}

/** Keep the page's query string (local ?org=, UTM) on the form's own requests. */
function withSearch(url: string): string {
  return `${url}${window.location.search}`;
}

function tokenKey(formId: string) {
  return `pc-form-token:${formId}`;
}

function readToken(formId: string): string | null {
  try {
    return sessionStorage.getItem(tokenKey(formId));
  } catch {
    return null;
  }
}

function writeToken(formId: string, token: string | null) {
  try {
    if (token) sessionStorage.setItem(tokenKey(formId), token);
    else sessionStorage.removeItem(tokenKey(formId));
  } catch {
    // Storage blocked: autosave just starts a new partial next time.
  }
}

export function FormRenderer({
  form,
  theme,
  mode,
  submitUrl,
  progressUrl,
  showHeader = true,
}: {
  form: PublicForm;
  theme: ResolvedTheme;
  mode: RendererMode;
  submitUrl?: string;
  progressUrl?: string;
  showHeader?: boolean;
}) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [page, setPage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const files = useRef(new Map<string, File>());
  const startedAt = useRef<number>(0);
  const utm = useRef<Record<string, string>>({});
  const honeypot = useRef<HTMLInputElement>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const state = useMemo(() => resolveForm(form.fields, form.layout, answers), [form.fields, form.layout, answers]);
  const byId = useMemo(() => new Map(form.fields.map((field) => [field.id, field])), [form.fields]);
  const current = state.path.includes(page) ? page : (state.path.find((index) => index >= page) ?? state.path.at(-1) ?? 0);
  const next = nextOnPath(state, current);
  const previous = previousOnPath(state, current);
  const position = state.path.indexOf(current);

  useEffect(() => {
    startedAt.current = Date.now();
    utm.current = captureUtm(window.location.search);
    const hidden = hiddenValues(form.fields, window.location.search);
    if (Object.keys(hidden).length) setAnswers((value) => ({ ...hidden, ...value }));
  }, [form.fields]);

  // Embeds post their height to the parent page; an iframe cannot size itself.
  useEffect(() => {
    if (mode !== "embed" || !rootRef.current) return;
    const post = () => window.parent?.postMessage({ type: "pubcommand-form:height", formId: form.id, height: document.documentElement.scrollHeight }, "*");
    const observer = new ResizeObserver(post);
    observer.observe(rootRef.current);
    post();
    return () => observer.disconnect();
  }, [mode, form.id]);

  const saveProgress = useCallback(
    (values: AnswerMap, pageIndex: number) => {
      if (mode === "preview" || !progressUrl) return;
      const body = {
        answers: values,
        utm: utm.current,
        startedAt: startedAt.current,
        honeypot: honeypot.current?.value ?? "",
        resumeToken: readToken(form.id),
        lastPageIndex: pageIndex,
        referrer: document.referrer || null,
      };
      fetch(withSearch(progressUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { resumeToken?: string } | null) => {
          if (data?.resumeToken) writeToken(form.id, data.resumeToken);
        })
        .catch(() => undefined);
    },
    [mode, progressUrl, form.id],
  );

  const goNext = useCallback(
    (values: AnswerMap, fromPage: number) => {
      const resolved = resolveForm(form.fields, form.layout, values);
      const pageErrs = pageErrors(form.fields, resolved, fromPage, values);
      setErrors(pageErrs);
      if (Object.keys(pageErrs).length) return false;
      const target = nextOnPath(resolved, fromPage);
      if (target === null) return false;
      setPage(target);
      saveProgress(values, target);
      rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      return true;
    },
    [form.fields, form.layout, saveProgress],
  );

  async function submit(values: AnswerMap) {
    const resolved = resolveForm(form.fields, form.layout, values);
    const allErrors: Record<string, string> = {};
    for (const index of resolved.path) Object.assign(allErrors, pageErrors(form.fields, resolved, index, values));
    setErrors(allErrors);
    if (Object.keys(allErrors).length) {
      const firstBad = resolved.path.find((index) => resolved.pages[index]!.fieldIds.some((id) => allErrors[id]));
      if (firstBad !== undefined) setPage(firstBad);
      return;
    }
    if (mode === "preview") {
      setDone(true);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const data = new FormData();
    data.set(
      "payload",
      JSON.stringify({
        answers: values,
        utm: utm.current,
        startedAt: startedAt.current,
        honeypot: honeypot.current?.value ?? "",
        resumeToken: readToken(form.id),
        lastPageIndex: current,
        referrer: document.referrer || null,
      }),
    );
    for (const [fieldId, file] of files.current) if (resolved.visibleIds.has(fieldId)) data.set(`file:${fieldId}`, file);
    try {
      const response = await fetch(withSearch(submitUrl!), { method: "POST", body: data });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: Record<string, string> };
      if (!response.ok || !result.ok) {
        if (result.errors) {
          setErrors(result.errors);
          const firstBad = resolved.path.find((index) => resolved.pages[index]!.fieldIds.some((id) => result.errors?.[id]));
          if (firstBad !== undefined) setPage(firstBad);
        }
        setFormError(result.error ?? "Some answers need another look.");
        return;
      }
      writeToken(form.id, null);
      setDone(true);
      if (mode === "embed") window.parent?.postMessage({ type: "pubcommand-form:submitted", formId: form.id }, "*");
      if (mode === "public" && form.redirectUrl) setTimeout(() => window.location.assign(form.redirectUrl!), 2500);
    } catch {
      setFormError("Could not send your answers. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Auto-advance is armed HERE, when the person answers, never from an effect
   * watching answers: an effect would fire again when they press Back.
   */
  function setAnswer(field: FieldDef, value: unknown) {
    const values = { ...answers, [field.id]: value };
    setAnswers(values);
    if (errors[field.id]) setErrors(({ [field.id]: _gone, ...rest }) => rest);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (!form.autoAdvance || form.layout !== "paginated" || !AUTO_ADVANCE_TYPES.has(field.type)) return;
    const resolved = resolveForm(form.fields, form.layout, values);
    const shown = resolved.pages[current]?.fieldIds.filter((id) => resolved.visibleIds.has(id) && fieldSpec(byId.get(id)!.type)?.captures) ?? [];
    if (shown.length !== 1 || shown[0] !== field.id || nextOnPath(resolved, current) === null) return;
    advanceTimer.current = setTimeout(() => goNext(values, current), 350);
  }

  const accentStyle = { "--fa": theme.accentColor, "--fa-ink": contrastText(theme.accentColor) } as React.CSSProperties;
  const pageFields = (state.pages[current]?.fieldIds ?? []).filter((id) => state.visibleIds.has(id)).map((id) => byId.get(id)!);
  const total = state.path.length;

  return (
    <div ref={rootRef} style={accentStyle} className={mode === "embed" ? "bg-transparent" : "min-h-full bg-[#f5f6f8]"}>
      {showHeader && mode !== "embed" ? <FormHeader theme={theme} /> : null}
      <main className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
        <div className="rounded-xl border border-[#e1e4ea] bg-white p-5 shadow-sm sm:p-7">
          {done ? (
            <div className="py-6 text-center" role="status">
              <h1 className="[overflow-wrap:anywhere] text-2xl font-semibold tracking-tight text-[#0b1220]">{form.confirmTitle}</h1>
              {form.confirmMessage ? <p className="mt-2 whitespace-pre-line text-sm text-[#3e4a5c]">{form.confirmMessage}</p> : null}
              {mode === "preview" ? <p className="mt-4 text-xs text-[#5b6577]">Preview only. Nothing was saved.</p> : null}
              {form.redirectUrl && mode === "embed" ? (
                <a href={form.redirectUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-[color:var(--fa)] px-4 text-sm font-semibold text-[color:var(--fa-ink)]">
                  Continue
                </a>
              ) : null}
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(event) => {
                // Enter key: never submit natively. Continue or Submit decides.
                event.preventDefault();
                if (next !== null) goNext(answers, current);
                else void submit(answers);
              }}
            >
              {position <= 0 ? (
                <div className="mb-5">
                  <h1 className="[overflow-wrap:anywhere] text-2xl font-semibold tracking-tight text-[#0b1220]">{form.title}</h1>
                  {form.description ? <p className="mt-2 whitespace-pre-line text-sm text-[#3e4a5c]">{form.description}</p> : null}
                </div>
              ) : null}
              {form.showProgress && total > 1 ? (
                <div className="mb-5" aria-label={`Step ${position + 1} of ${total}`}>
                  <div className="mb-1 text-xs text-[#5b6577]">
                    Step {position + 1} of {total}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e1e4ea]">
                    <div className="h-full rounded-full bg-[color:var(--fa)] transition-all" style={{ width: `${progressPercent(position + 1, total)}%` }} />
                  </div>
                </div>
              ) : null}

              <div className="space-y-6">
                {pageFields.map((field) => (
                  <FieldBlock key={field.id} field={field} value={answers[field.id]} error={errors[field.id]} onChange={(value) => setAnswer(field, value)} files={files.current} />
                ))}
                {pageFields.length === 0 ? <p className="text-sm text-[#5b6577]">This form has no questions yet.</p> : null}
              </div>

              {/* Honeypot: invisible to people, filled by bots. A filled one flags the response; it is still kept. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
                <label>
                  Leave this empty
                  <input ref={honeypot} type="text" name="company_website" tabIndex={-1} autoComplete="off" defaultValue="" />
                </label>
              </div>

              {formError ? (
                <p role="alert" className="mt-5 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">
                  {formError}
                </p>
              ) : null}

              {/* Both actions are type="button" with distinct keys: React must never reuse one node and flip its type mid-click. */}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                {previous !== null ? (
                  <button key="back" type="button" onClick={() => setPage(previous)} className="min-h-11 rounded-md border border-[#e1e4ea] bg-white px-4 text-sm font-semibold text-[#0b1220]">
                    Back
                  </button>
                ) : null}
                {next !== null ? (
                  <button key="continue" type="button" onClick={() => goNext(answers, current)} className="min-h-11 flex-1 rounded-md bg-[color:var(--fa)] px-5 text-sm font-semibold text-[color:var(--fa-ink)] sm:flex-none">
                    Continue
                  </button>
                ) : (
                  <button
                    key="submit"
                    type="button"
                    disabled={submitting}
                    onClick={() => void submit(answers)}
                    className="min-h-11 flex-1 rounded-md bg-[color:var(--fa)] px-5 text-sm font-semibold text-[color:var(--fa-ink)] disabled:opacity-60 sm:flex-none"
                  >
                    {submitting ? "Sending…" : form.submitLabel || "Submit"}
                  </button>
                )}
              </div>
              <Disclaimer form={form} theme={theme} />
            </form>
          )}
        </div>
        {theme.footerText && mode !== "embed" ? <p className="mt-4 text-center text-xs text-[#5b6577]">{theme.footerText}</p> : null}
      </main>
    </div>
  );
}

const inputClass =
  "block w-full min-h-11 rounded-md border border-[#cfd4dc] bg-white px-3 py-2 text-base text-[#0b1220] outline-none focus:border-[color:var(--fa)] focus:ring-2 focus:ring-[color:var(--fa)]/20";

function FieldBlock({ field, value, error, onChange, files }: { field: FieldDef; value: unknown; error?: string; onChange: (value: unknown) => void; files: Map<string, File> }) {
  const id = `q-${field.id}`;
  if (field.type === "statement") {
    return (
      <div>
        <h2 className="[overflow-wrap:anywhere] text-lg font-semibold text-[#0b1220]">{field.label}</h2>
        {field.config.body ? <p className="mt-1 whitespace-pre-line text-sm text-[#3e4a5c]">{field.config.body}</p> : null}
      </div>
    );
  }
  const describedBy = [field.helpText ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const grouped = ["single_choice", "multi_choice", "yes_no", "rating", "scale", "nps", "address", "consent", "signature"].includes(field.type);
  const Label = grouped ? "legend" : "label";
  const body = (
    <>
      <Label {...(grouped ? {} : { htmlFor: id })} className="[overflow-wrap:anywhere] mb-1.5 block text-[15px] font-semibold text-[#0b1220]">
        {field.label}
        {field.required ? <span className="ml-1 text-[#b42318]" aria-label="required">*</span> : null}
      </Label>
      {field.helpText ? (
        <p id={`${id}-help`} className="mb-2 text-sm text-[#5b6577]">
          {field.helpText}
        </p>
      ) : null}
      <FieldControl field={field} id={id} value={value} onChange={onChange} describedBy={describedBy} invalid={Boolean(error)} files={files} />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-[#b42318]">
          {error}
        </p>
      ) : null}
    </>
  );
  return grouped ? <fieldset className="min-w-0">{body}</fieldset> : <div>{body}</div>;
}

function FieldControl({
  field,
  id,
  value,
  onChange,
  describedBy,
  invalid,
  files,
}: {
  field: FieldDef;
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  describedBy?: string;
  invalid: boolean;
  files: Map<string, File>;
}) {
  const common = { id, "aria-describedby": describedBy, "aria-invalid": invalid || undefined };
  const str = typeof value === "string" ? value : "";
  const placeholder = field.placeholder || undefined;
  switch (field.type) {
    case "name":
      return <input {...common} className={inputClass} autoComplete="name" value={str} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "email":
      return <input {...common} className={inputClass} type="email" inputMode="email" autoComplete="email" value={str} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "phone":
      return <input {...common} className={inputClass} type="tel" inputMode="tel" autoComplete="tel" value={str} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "website":
      return <input {...common} className={inputClass} type="url" inputMode="url" value={str} placeholder={placeholder ?? "https://"} onChange={(e) => onChange(e.target.value)} />;
    case "short_text":
    case "hidden":
      return <input {...common} className={inputClass} value={str} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "long_text":
      return <textarea {...common} className={`${inputClass} min-h-28`} rows={4} value={str} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return (
        <div className="flex items-center gap-2">
          {field.config.prefix ? <span className="text-sm text-[#3e4a5c]">{field.config.prefix}</span> : null}
          <input
            {...common}
            className={inputClass}
            inputMode="decimal"
            value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.config.suffix ? <span className="text-sm text-[#3e4a5c]">{field.config.suffix}</span> : null}
        </div>
      );
    case "date":
      return <input {...common} className={inputClass} type="date" value={str} onChange={(e) => onChange(e.target.value)} />;
    case "time":
      return <input {...common} className={inputClass} type="time" value={str} onChange={(e) => onChange(e.target.value)} />;
    case "dropdown":
      return (
        <select {...common} className={inputClass} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(field.config.choices ?? []).map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      );
    case "single_choice":
      return <ChoiceList field={field} multi={false} value={value} onChange={onChange} describedBy={describedBy} />;
    case "multi_choice":
      return <ChoiceList field={field} multi value={value} onChange={onChange} describedBy={describedBy} />;
    case "yes_no":
      return (
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-describedby={describedBy}>
          {[
            [true, "Yes"],
            [false, "No"],
          ].map(([option, label]) => (
            <button
              key={String(label)}
              type="button"
              role="radio"
              aria-checked={value === option}
              onClick={() => onChange(option)}
              className={`min-h-12 rounded-md border text-sm font-semibold ${value === option ? "border-[color:var(--fa)] bg-[color:var(--fa)] text-[color:var(--fa-ink)]" : "border-[#cfd4dc] bg-white text-[#0b1220]"}`}
            >
              {label as string}
            </button>
          ))}
        </div>
      );
    case "rating": {
      const max = field.config.max ?? 5;
      return (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-describedby={describedBy}>
          {Array.from({ length: max }, (_, index) => index + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} of ${max}`}
              onClick={() => onChange(n)}
              className={`h-11 w-11 text-3xl leading-none ${typeof value === "number" && n <= value ? "text-[#f5a524]" : "text-[#cfd4dc]"}`}
            >
              ★
            </button>
          ))}
        </div>
      );
    }
    case "scale":
    case "nps": {
      const min = field.type === "nps" ? 0 : (field.config.min ?? 1);
      const max = field.type === "nps" ? 10 : (field.config.max ?? 5);
      const values = Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
      return (
        <div aria-describedby={describedBy}>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }} role="radiogroup">
            {values.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                onClick={() => onChange(n)}
                className={`min-h-11 rounded-md border text-sm font-semibold ${value === n ? "border-[color:var(--fa)] bg-[color:var(--fa)] text-[color:var(--fa-ink)]" : "border-[#cfd4dc] bg-white text-[#0b1220]"}`}
              >
                {n}
              </button>
            ))}
          </div>
          {field.config.leftLabel || field.config.rightLabel ? (
            <div className="mt-1 flex justify-between gap-2 text-xs text-[#5b6577]">
              <span>{field.config.leftLabel}</span>
              <span className="text-right">{field.config.rightLabel}</span>
            </div>
          ) : null}
        </div>
      );
    }
    case "consent":
      return (
        <label className="flex min-h-11 items-start gap-3 text-sm text-[#0b1220]">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--fa)]" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} />
          <span>{field.config.consentText || "I agree."}</span>
        </label>
      );
    case "address": {
      const address = (value && typeof value === "object" ? value : {}) as Partial<AddressValue>;
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {ADDRESS_PARTS.map((part) => (
            <input
              key={part.key}
              aria-label={part.label}
              placeholder={part.label}
              className={`${inputClass} ${part.key === "line1" || part.key === "line2" ? "sm:col-span-2" : ""}`}
              autoComplete={{ line1: "address-line1", line2: "address-line2", city: "address-level2", region: "address-level1", postal: "postal-code", country: "country-name" }[part.key]}
              value={address[part.key] ?? ""}
              onChange={(e) => onChange({ ...address, [part.key]: e.target.value })}
            />
          ))}
        </div>
      );
    }
    case "file_upload":
      return (
        <div>
          <input
            {...common}
            type="file"
            accept={(field.config.accept ?? []).join(",") || undefined}
            className="block w-full rounded-md border border-dashed border-[#cfd4dc] bg-[#f5f6f8] px-3 py-5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[color:var(--fa)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[color:var(--fa-ink)]"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                files.set(field.id, file);
                onChange({ filename: file.name, size: file.size, mimeType: file.type });
              } else {
                files.delete(field.id);
                onChange(undefined);
              }
            }}
          />
          <p className="mt-1 text-xs text-[#5b6577]">
            {(field.config.accept ?? []).join(", ")} up to {field.config.maxSizeMb ?? 10} MB
          </p>
        </div>
      );
    case "signature":
      return <SignaturePad field={field} value={value as SignatureValue | undefined} onChange={onChange} />;
    default:
      return null;
  }
}

function ChoiceList({ field, multi, value, onChange, describedBy }: { field: FieldDef; multi: boolean; value: unknown; onChange: (value: unknown) => void; describedBy?: string }) {
  const selected = multi ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === "string" ? [value] : [];
  const other = selected.find((item) => item.startsWith(OTHER_PREFIX));
  const [otherOpen, setOtherOpen] = useState(Boolean(other));
  const toggle = (id: string) => {
    if (!multi) return onChange(id);
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  };
  const setOther = (text: string) => {
    const rest = selected.filter((item) => !item.startsWith(OTHER_PREFIX));
    const next = text ? `${OTHER_PREFIX}${text}` : null;
    if (multi) onChange(next ? [...rest, next] : rest);
    else onChange(next ?? "");
  };
  const box = (active: boolean) =>
    `flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm ${active ? "border-[color:var(--fa)] bg-[color:var(--fa)]/5 text-[#0b1220]" : "border-[#cfd4dc] bg-white text-[#0b1220]"}`;
  return (
    <div className="space-y-2" role={multi ? "group" : "radiogroup"} aria-describedby={describedBy}>
      {(field.config.choices ?? []).map((choice) => {
        const active = selected.includes(choice.id);
        return (
          <button key={choice.id} type="button" role={multi ? "checkbox" : "radio"} aria-checked={active} onClick={() => toggle(choice.id)} className={box(active)}>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center border ${multi ? "rounded" : "rounded-full"} ${active ? "border-[color:var(--fa)] bg-[color:var(--fa)] text-[color:var(--fa-ink)]" : "border-[#98a2b3]"}`}>
              {active ? <span className="text-[11px] leading-none">✓</span> : null}
            </span>
            <span className="[overflow-wrap:anywhere]">{choice.label}</span>
          </button>
        );
      })}
      {field.config.allowOther ? (
        <div>
          <button type="button" role={multi ? "checkbox" : "radio"} aria-checked={Boolean(other) || otherOpen} onClick={() => setOtherOpen(true)} className={box(Boolean(other))}>
            <span className={`h-5 w-5 shrink-0 border ${multi ? "rounded" : "rounded-full"} ${other ? "border-[color:var(--fa)] bg-[color:var(--fa)]" : "border-[#98a2b3]"}`} />
            Other
          </button>
          {otherOpen || other ? (
            <input aria-label="Other answer" className={`${inputClass} mt-2`} value={other ? other.slice(OTHER_PREFIX.length) : ""} onChange={(e) => setOther(e.target.value)} placeholder="Type your answer" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SignaturePad({ field, value, onChange }: { field: FieldDef; value: SignatureValue | undefined; onChange: (value: unknown) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [typed, setTyped] = useState(value?.typedName ?? "");

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = element.clientWidth * ratio;
    element.height = element.clientHeight * ratio;
    const context = element.getContext("2d");
    if (context) {
      context.scale(ratio, ratio);
      context.lineWidth = 2.2;
      context.lineCap = "round";
      context.strokeStyle = "#0b1220";
    }
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top] as const;
  };

  return (
    <div>
      <canvas
        ref={canvas}
        aria-label="Signature pad. Draw with your finger or mouse."
        className="block h-36 w-full touch-none rounded-md border border-[#cfd4dc] bg-white"
        onPointerDown={(event) => {
          drawing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          const context = canvas.current?.getContext("2d");
          const [x, y] = point(event);
          context?.beginPath();
          context?.moveTo(x, y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const context = canvas.current?.getContext("2d");
          const [x, y] = point(event);
          context?.lineTo(x, y);
          context?.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange({ ...value, dataUrl: canvas.current?.toDataURL("image/png"), typedName: typed || undefined });
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="min-h-11 rounded-md border border-[#cfd4dc] px-3 text-sm"
          onClick={() => {
            const element = canvas.current;
            element?.getContext("2d")?.clearRect(0, 0, element.width, element.height);
            onChange(typed ? { typedName: typed } : undefined);
          }}
        >
          Clear
        </button>
        {field.config.allowTyped !== false ? (
          <input
            aria-label="Or type your full name"
            placeholder="Or type your full name"
            className={`${inputClass} min-w-0 flex-1`}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              onChange({ ...value, typedName: e.target.value || undefined });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
