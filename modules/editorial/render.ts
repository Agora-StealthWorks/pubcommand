import type { WritingAssistResult, WritingCompleter } from "./assist";
import { writingAssist } from "./assist";
import type { EditorialIssue, IssueStatus } from "./store";
import { getIssue, listIssues, syncSendStatsFromEsp } from "./store";

export type EditorialPageInput = {
  organizationId: string;
  issueId?: string;
  prompt?: string;
  canWrite: boolean;
  assist?: WritingCompleter;
};

type AssistView =
  | { kind: "blocked" }
  | { kind: "idle" }
  | { kind: "result"; result: WritingAssistResult };

const CSS = `
.ed{color:#0b1220;font:15px/1.5 ui-sans-serif,system-ui,sans-serif;max-width:100%;overflow-wrap:anywhere}
.ed h1{font-size:1.5rem;line-height:1.25;margin:0;font-weight:600}
.ed h2{font-size:1.125rem;line-height:1.3;margin:0;font-weight:600}
.ed p{margin:.35rem 0 0}
.ed a{color:#1d4ed8;font-weight:600}
.ed code{font-size:.85em;overflow-wrap:anywhere;word-break:break-all}
.ed-muted{color:#3e4a5c}
.ed-header{margin-bottom:1.25rem}
.ed-table{overflow-x:auto;border:1px solid #e1e4ea;border-radius:8px;background:#fff}
.ed table{width:100%;border-collapse:collapse}
.ed th,.ed td{text-align:left;padding:.7rem .85rem;border-bottom:1px solid #e1e4ea;vertical-align:top}
.ed tr:last-child td{border-bottom:0}
.ed th{font-size:.75rem;letter-spacing:.04em;text-transform:uppercase;color:#3e4a5c}
.ed-card,.ed-note,.ed-todo{border:1px solid #e1e4ea;border-radius:8px;padding:.9rem 1rem}
.ed-card{background:#fff;margin-top:.5rem}
.ed-note,.ed-todo{background:#f5f6f8;margin-top:.9rem}
.ed-stats{display:grid;grid-template-columns:1fr;gap:.75rem;margin:.9rem 0}@media (min-width:640px){.ed-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ed-stat{border:1px solid #e1e4ea;border-radius:8px;padding:.75rem .85rem;background:#fff}
.ed-stat dt{font-size:.75rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#3e4a5c}
.ed-stat dd{font-size:1.25rem;font-weight:600;margin:.2rem 0 0}
.ed label{display:block;font-weight:600;margin-top:.9rem}
.ed textarea{display:block;width:100%;min-height:7rem;margin-top:.35rem;border:1px solid #e1e4ea;border-radius:6px;padding:.7rem;font:inherit;box-sizing:border-box}
.ed button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:.75rem;background:#1d4ed8;color:#fff;border:1px solid #1d4ed8;border-radius:6px;padding:.55rem .9rem;font-weight:600}
.ed-back{margin:0 0 .75rem}
.ed-back a{display:inline-flex;align-items:center;min-height:44px}
`.replaceAll("\n", "");

export async function renderEditorialPage(input: EditorialPageInput): Promise<string> {
  if (!input.organizationId) throw new Error("organizationId is required");
  const requestedId = input.issueId?.trim() ?? "";
  const body = requestedId ? await renderRequestedIssue(input, requestedId) : renderList(listIssues(input.organizationId));
  return layout(input.organizationId, body);
}

async function renderRequestedIssue(input: EditorialPageInput, issueId: string): Promise<string> {
  const issue = getIssue(input.organizationId, issueId);
  if (!issue) {
    return `<p class="ed-back"><a href="/editorial">All issues</a></p><p class="ed-card">No issue with that id is stored for this organization (${escapeHtml(issueId)}).</p>`;
  }
  const assist = await assistView(issue, input);
  return `<p class="ed-back"><a href="/editorial">All issues</a></p>
<article class="ed-card" data-issue-id="${escapeHtml(issue.id)}">
  <h2>${escapeHtml(issue.title)}</h2>
  <p class="ed-muted">${escapeHtml(issue.subject)}</p>
  <p>${escapeHtml(statusLabel(issue.status))}</p>
  <p>${escapeHtml(issue.body)}</p>
  <dl class="ed-stats">
    <div class="ed-stat"><dt>Opens</dt><dd>${escapeHtml(formatCount(issue.opens))}</dd></div>
    <div class="ed-stat"><dt>Clicks</dt><dd>${escapeHtml(formatCount(issue.clicks))}</dd></div>
    <div class="ed-stat"><dt>Revenue</dt><dd>${escapeHtml(formatRevenue(issue.revenue))}</dd></div>
  </dl>
  <p class="ed-muted">Scheduled ${escapeHtml(formatWhen(issue.scheduledFor))} · Sent ${escapeHtml(formatWhen(issue.sentAt))}</p>
  ${renderAssist(issue, input, assist)}
</article>`;
}

function renderList(issues: readonly EditorialIssue[]): string {
  const rows = issues
    .map(
      (issue) => `<tr>
        <td><a href="${escapeHtml(issueHref(issue.id))}">${escapeHtml(issue.title)}</a><div class="ed-muted">${escapeHtml(issue.subject)}</div></td>
        <td>${escapeHtml(statusLabel(issue.status))}</td>
        <td>${escapeHtml(formatCount(issue.opens))}</td>
        <td>${escapeHtml(formatCount(issue.clicks))}</td>
        <td>${escapeHtml(formatRevenue(issue.revenue))}</td>
      </tr>`,
    )
    .join("");
  return `<div class="ed-table"><table>
    <thead><tr><th>Issue</th><th>Status</th><th>Opens</th><th>Clicks</th><th>Revenue</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function layout(organizationId: string, body: string): string {
  const todo = syncSendStatsFromEsp();
  return `<section class="ed" data-module="editorial" data-organization-id="${escapeHtml(organizationId)}">
<style>${CSS}</style>
<header class="ed-header">
  <h1>Editorial</h1>
  <p class="ed-muted">Issues and send stats for this organization.</p>
  <p>Organization <code>${escapeHtml(organizationId)}</code></p>
</header>
${body}
<p class="ed-todo">${escapeHtml(todo.reason)}</p>
</section>`;
}

async function assistView(issue: EditorialIssue, input: EditorialPageInput): Promise<AssistView> {
  if (!input.canWrite) return { kind: "blocked" };
  const prompt = input.prompt?.trim() ?? "";
  if (!prompt) return { kind: "idle" };
  const result = await writingAssist(
    { organizationId: issue.organizationId, issueTitle: issue.title, prompt },
    input.assist,
  );
  return { kind: "result", result };
}

function renderAssist(issue: EditorialIssue, input: EditorialPageInput, assist: AssistView): string {
  if (assist.kind === "blocked") {
    return `<p class="ed-note">Writing assist needs the editorial.write permission.</p>`;
  }
  const prompt = assist.kind === "result" ? (input.prompt?.trim() ?? "") : "";
  const result =
    assist.kind === "result"
      ? assist.result.status === "ok"
        ? `<pre class="ed-note">${escapeHtml(assist.result.text)}</pre>`
        : `<p class="ed-note">${escapeHtml(assist.result.reason)}</p>`
      : `<p class="ed-muted">The assist calls the AI package when you submit a prompt.</p>`;
  return `<form method="get" action="/editorial">
    <input type="hidden" name="issue" value="${escapeHtml(issue.id)}">
    <label for="ed-prompt">Writing assist</label>
    <textarea id="ed-prompt" name="prompt">${escapeHtml(prompt)}</textarea>
    <button type="submit">Ask for a draft</button>
  </form>
  ${result}
  <p class="ed-muted">TODO: the assist does not write the issue body yet.</p>`;
}

function issueHref(id: string): string {
  return `/editorial?issue=${encodeURIComponent(id)}`;
}

function statusLabel(status: IssueStatus): string {
  if (status === "draft") return "Draft";
  if (status === "scheduled") return "Scheduled";
  return "Sent";
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatRevenue(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
