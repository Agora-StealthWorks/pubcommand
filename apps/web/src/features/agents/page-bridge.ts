import { DomUtils, parseDocument } from "htmlparser2";

type AnyNode = ReturnType<typeof parseDocument>["children"][number];
type Element = Extract<AnyNode, { name: string; attribs: Record<string, string> }>;
import { rootDomain } from "@/lib/auth";
import { AGENT_HEADER, makeAgentPass } from "./assertion";
import { fetchRemoteImage } from "./remote-image";
import { ToolError } from "./tool-kit";

/**
 * The page bridge: AI agents use PubCommand's apps the way a person does. The MCP server asks
 * this same app for a page on the organization's host, as the agent (a signed two-minute pass,
 * see assertion.ts), and turns the HTML into text, links and forms. Submitting a form posts it
 * like a browser without JavaScript, so the app's own server action runs, with the agent's
 * permissions, validation and audit log, and its redirect message comes back as the result.
 */

export type BridgeAgent = { userId: string; agentId: string; tokenId: string; homeOrganizationId: string; organizationId: string; organizationSlug: string; brandId: string | null; fullAccess: boolean };

/** Pages agents never use: their own management and approvals, people's accounts, billing and domain purchases. */
const BLOCKED = ["/agents", "/account", "/billing", "/settings/domains", "/api", "/login", "/logout", "/reset-password", "/sites", "/2fa"];

export function checkPath(path: string): string {
  const value = path.trim();
  if (!value.startsWith("/") || value.startsWith("//")) throw new ToolError("path must be a page of the app, starting with /, e.g. /funnels.");
  const url = new URL(value, "http://x");
  if (BLOCKED.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) throw new ToolError(`AI agents cannot use ${url.pathname}.`);
  return url.pathname + url.search;
}

function orgHost(slug: string): { host: string; proto: string } {
  const root = rootDomain();
  const local = root === "localhost" || !root.includes(".");
  return { host: local ? `${slug}.${root}:${process.env.PORT ?? "3000"}` : `${slug}.${root}`, proto: local ? "http" : "https" };
}

function bridgeHeaders(agent: BridgeAgent): Record<string, string> {
  const { host, proto } = orgHost(agent.organizationSlug);
  return {
    "x-forwarded-host": host,
    "x-forwarded-proto": proto,
    "user-agent": "PubCommand-Agent/1.0",
    [AGENT_HEADER]: makeAgentPass({ u: agent.userId, o: agent.organizationId, h: agent.homeOrganizationId, a: agent.agentId, t: agent.tokenId, b: agent.brandId, s: agent.fullAccess }),
  };
}

const base = () => `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

/** A page (redirects followed on the same host), as the agent. */
async function getPage(agent: BridgeAgent, path: string): Promise<{ path: string; status: number; html: string }> {
  let current = path;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(`${base()}${current}`, { headers: bridgeHeaders(agent), redirect: "manual", signal: AbortSignal.timeout(30_000) });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, `http://${orgHost(agent.organizationSlug).host}`);
      if (/\/login$/.test(next.pathname)) throw new ToolError("That page needs access this agent does not have.");
      if (next.host !== orgHost(agent.organizationSlug).host && !location.startsWith("/")) throw new ToolError(`That page leads off the organization's app (${next.host}).`);
      current = checkPath(next.pathname + next.search);
      continue;
    }
    return { path: current, status: response.status, html: await response.text() };
  }
  throw new ToolError("That page redirects too many times.");
}

// ── Reading a page ──────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "li", "ul", "ol", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "header", "footer", "form", "fieldset", "legend", "label", "br", "dl", "dt", "dd", "details", "summary", "pre", "blockquote"]);
const SKIP_TAGS = new Set(["script", "style", "svg", "noscript", "template", "nav", "select", "option", "textarea", "button", "input"]);

function textOf(node: AnyNode, out: string[]): void {
  if (node.type === "text") {
    out.push((node as unknown as { data: string }).data);
    return;
  }
  if (node.type !== "tag" && node.type !== "root") return;
  const element = node as Element;
  const tag = element.name?.toLowerCase();
  if (tag && SKIP_TAGS.has(tag)) return;
  if (tag === "td" || tag === "th") out.push(" | ");
  if (tag && BLOCK_TAGS.has(tag)) out.push("\n");
  if (tag && /^h[1-6]$/.test(tag)) out.push("#".repeat(Number(tag[1])) + " ");
  for (const child of element.children ?? []) textOf(child, out);
  if (tag && BLOCK_TAGS.has(tag)) out.push("\n");
}

function clean(text: string): string {
  return text
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const attr = (element: Element, name: string) => element.attribs?.[name];

type FormField = { name: string; type: string; label: string | null; value?: string | string[] | null; checked?: boolean; required?: boolean; options?: { value: string; label: string; selected: boolean }[]; multiple?: boolean };
type FormButton = { label: string; name: string | null; value: string | null };
export type PageForm = { index: number; title: string; fields: FormField[]; buttons: FormButton[]; hidden: [string, string][]; actionFields: [string, string][] };

function labelFor(root: AnyNode[], element: Element): string | null {
  const id = attr(element, "id");
  if (id) {
    const label = DomUtils.findOne((n) => n.name === "label" && n.attribs?.for === id, root, true);
    if (label) return clean(DomUtils.textContent(label)) || null;
  }
  let parent = element.parent as Element | null;
  while (parent && parent.type === "tag") {
    if (parent.name === "label") return clean(DomUtils.textContent(parent)) || null;
    parent = parent.parent as Element | null;
  }
  return attr(element, "aria-label") ?? attr(element, "placeholder") ?? null;
}

function readForms(dom: AnyNode[]): PageForm[] {
  const forms = DomUtils.findAll((n) => n.name === "form", dom);
  const out: PageForm[] = [];
  for (const form of forms) {
    const inputs = DomUtils.findAll((n) => n.name === "input" || n.name === "textarea" || n.name === "select" || n.name === "button", [form]);
    const actionFields: [string, string][] = [];
    const hidden: [string, string][] = [];
    const fields: FormField[] = [];
    const buttons: FormButton[] = [];
    for (const el of inputs) {
      const name = attr(el, "name") ?? "";
      const type = (attr(el, "type") ?? (el.name === "input" ? "text" : el.name)).toLowerCase();
      if (name.startsWith("$ACTION")) {
        actionFields.push([name, attr(el, "value") ?? ""]);
        continue;
      }
      if (el.name === "button" || type === "submit") {
        if (type === "button" || type === "reset") continue;
        buttons.push({ label: clean(DomUtils.textContent(el)) || attr(el, "value") || attr(el, "aria-label") || "Submit", name: name || null, value: attr(el, "value") ?? null });
        continue;
      }
      if (!name) continue;
      if (type === "hidden") {
        hidden.push([name, attr(el, "value") ?? ""]);
        continue;
      }
      const field: FormField = { name, type, label: labelFor(dom, el), required: "required" in (el.attribs ?? {}) || undefined };
      if (el.name === "select") {
        field.type = "select";
        field.multiple = "multiple" in (el.attribs ?? {}) || undefined;
        field.options = DomUtils.findAll((n) => n.name === "option", [el]).map((o) => ({ value: attr(o, "value") ?? clean(DomUtils.textContent(o)), label: clean(DomUtils.textContent(o)), selected: "selected" in (o.attribs ?? {}) }));
      } else if (el.name === "textarea") {
        field.type = "textarea";
        field.value = DomUtils.textContent(el);
      } else if (type === "checkbox" || type === "radio") {
        field.value = attr(el, "value") ?? "on";
        field.checked = "checked" in (el.attribs ?? {});
      } else if (type !== "file") {
        field.value = attr(el, "value") ?? "";
      }
      fields.push(field);
    }
    // Only forms that run an app action (server action); plain search forms are just links.
    if (actionFields.length === 0) continue;
    const heading = DomUtils.findOne((n) => /^h[1-6]$/.test(n.name) || n.name === "legend", [form], true);
    out.push({ index: out.length, title: clean(heading ? DomUtils.textContent(heading) : (buttons[0]?.label ?? "Form")).slice(0, 120), fields, buttons, hidden, actionFields });
  }
  return out;
}

export type PageView = {
  path: string;
  status: number;
  title: string;
  message: { notice?: string; error?: string };
  text: string;
  links: { text: string; href: string }[];
  forms: PageForm[];
};

export function readPage(path: string, status: number, html: string): PageView {
  const dom = parseDocument(html).children;
  const main = DomUtils.findOne((n) => n.name === "main", dom, true);
  const scope = main ? [main] : dom;
  const out: string[] = [];
  for (const node of scope) textOf(node, out);
  const titleEl = DomUtils.findOne((n) => n.name === "title", dom, true);
  const links = DomUtils.findAll((n) => n.name === "a" && typeof n.attribs?.href === "string" && n.attribs.href.startsWith("/") && !n.attribs.href.startsWith("//"), scope)
    .map((a) => ({ text: clean(DomUtils.textContent(a)).slice(0, 80), href: attr(a, "href")! }))
    .filter((link, i, all) => link.text && all.findIndex((other) => other.href === link.href) === i)
    .slice(0, 100);
  const query = new URL(path, "http://x").searchParams;
  return {
    path,
    status,
    title: titleEl ? clean(DomUtils.textContent(titleEl)) : "",
    message: { ...(query.get("notice") ? { notice: query.get("notice")! } : {}), ...(query.get("error") ? { error: query.get("error")! } : {}) },
    text: clean(out.join("")).slice(0, 12_000),
    links,
    forms: readForms(scope),
  };
}

export async function openPage(agent: BridgeAgent, rawPath: string): Promise<PageView> {
  const page = await getPage(agent, checkPath(rawPath));
  if (page.status === 404) throw new ToolError("No such page here, or this agent may not open it.");
  if (page.status >= 500) throw new ToolError(`The page failed to load (${page.status}).`);
  return readPage(page.path, page.status, page.html);
}

/** What an agent sees of a form: everything but the internal action fields. */
export function describeForm(form: PageForm) {
  return { index: form.index, title: form.title, fields: form.fields, buttons: form.buttons.map((b) => ({ label: b.label, ...(b.name ? { name: b.name, value: b.value } : {}) })), ...(form.hidden.length ? { hidden: Object.fromEntries(form.hidden) } : {}) };
}

// ── Submitting a form ───────────────────────────────────────────────────────

export type SubmitInput = { form: number | string; fields: Record<string, unknown>; button?: string; files?: Record<string, string> };

function pickForm(forms: PageForm[], wanted: number | string): PageForm {
  if (typeof wanted === "number") {
    const form = forms[wanted];
    if (!form) throw new ToolError(`This page has ${forms.length} form(s); form ${wanted} does not exist. Call open_page to see them.`);
    return form;
  }
  const w = wanted.trim().toLowerCase();
  const matches = forms.filter((f) => f.title.toLowerCase().includes(w) || f.buttons.some((b) => b.label.toLowerCase().includes(w)));
  if (matches.length !== 1) throw new ToolError(matches.length ? `"${wanted}" matches ${matches.length} forms; use its index from open_page.` : `No form matching "${wanted}". Call open_page to see the forms.`);
  return matches[0]!;
}

export async function submitForm(agent: BridgeAgent, rawPath: string, input: SubmitInput): Promise<{ result: "done" | "error" | "shown"; message: string | null; now_at: string; page: Pick<PageView, "title" | "text" | "links"> & { forms: ReturnType<typeof describeForm>[] } }> {
  const path = checkPath(rawPath);
  const page = await getPage(agent, path);
  if (page.status >= 400) throw new ToolError(`The page did not load (${page.status}).`);
  const view = readPage(page.path, page.status, page.html);
  const form = pickForm(view.forms, input.form);

  // Start from what the form already holds, like a browser would send it.
  const values = new Map<string, string[]>();
  const add = (name: string, value: string) => values.set(name, [...(values.get(name) ?? []), value]);
  for (const [name, value] of form.hidden) add(name, value);
  for (const field of form.fields) {
    if (field.type === "file") continue;
    if (field.type === "checkbox" || field.type === "radio") {
      if (field.checked) add(field.name, String(field.value ?? "on"));
    } else if (field.type === "select") {
      const selected = field.options?.filter((o) => o.selected) ?? [];
      const chosen = selected.length ? selected : field.multiple ? [] : field.options?.slice(0, 1) ?? [];
      for (const option of chosen) add(field.name, option.value);
    } else add(field.name, String(field.value ?? ""));
  }

  const known = new Set([...form.fields.map((f) => f.name), ...form.hidden.map(([n]) => n)]);
  const extra: string[] = [];
  for (const [name, value] of Object.entries(input.fields ?? {})) {
    if (name.startsWith("$")) throw new ToolError(`${name} is not a field you can set.`);
    // Fields the page only adds with JavaScript (e.g. an editor's "intent" buttons) can be sent too:
    // the app checks every value and permission on the server, as it does for a person.
    if (!known.has(name)) extra.push(name);
    const field = form.fields.find((f) => f.name === name);
    if (field?.type === "checkbox") {
      const boxes = form.fields.filter((f) => f.name === name && f.type === "checkbox");
      values.delete(name);
      if (boxes.length > 1) for (const v of Array.isArray(value) ? value : [value]) add(name, String(v));
      else if (value === true || value === "on" || value === "true" || value === String(field.value)) add(name, String(field.value ?? "on"));
      continue;
    }
    values.delete(name);
    for (const v of Array.isArray(value) ? value : [value]) add(name, v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  }

  const body = new FormData();
  for (const [name, list] of values) for (const v of list) body.append(name, v);
  for (const [name, value] of form.actionFields) body.append(name, value);
  if (input.button) {
    const w = input.button.toLowerCase();
    const button = form.buttons.find((b) => b.label.toLowerCase() === w || b.value?.toLowerCase() === w) ?? form.buttons.find((b) => b.label.toLowerCase().includes(w));
    if (!button) throw new ToolError(`No button "${input.button}". Buttons: ${form.buttons.map((b) => b.label).join(", ")}.`);
    if (button.name) body.append(button.name, button.value ?? "");
  } else {
    const first = form.buttons[0];
    if (first?.name) body.append(first.name, first.value ?? "");
  }
  for (const [name, url] of Object.entries(input.files ?? {})) {
    if (!form.fields.some((f) => f.name === name && f.type === "file")) throw new ToolError(`The form has no file field "${name}".`);
    const image = await fetchRemoteImage(url, 10);
    body.append(name, new File([image.data], image.filename, { type: image.mime }));
  }

  const response = await fetch(`${base()}${page.path}`, { method: "POST", headers: bridgeHeaders(agent), body, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    const next = new URL(location, `http://${orgHost(agent.organizationSlug).host}`);
    const notice = next.searchParams.get("notice");
    const error = next.searchParams.get("error");
    let after: PageView | null = null;
    try {
      after = await openPage(agent, next.pathname + next.search);
    } catch {
      after = null;
    }
    return {
      result: error ? "error" : "done",
      message: (error ?? notice ?? null) && extra.length ? `${error ?? notice} (sent extra fields: ${extra.join(", ")})` : (error ?? notice ?? null),
      now_at: next.pathname + next.search,
      page: { title: after?.title ?? "", text: (after?.text ?? "").slice(0, 4000), links: after?.links.slice(0, 40) ?? [], forms: (after?.forms ?? []).map(describeForm) },
    };
  }
  if (response.status >= 500) throw new ToolError(`The app could not do that (${response.status}). Check the values and try again.`);
  // No redirect: the page was shown again (e.g. a form that reports its result in place).
  const shown = readPage(page.path, response.status, await response.text());
  return { result: "shown", message: shown.message.error ?? shown.message.notice ?? null, now_at: page.path, page: { title: shown.title, text: shown.text.slice(0, 4000), links: shown.links.slice(0, 40), forms: shown.forms.map(describeForm) } };
}
