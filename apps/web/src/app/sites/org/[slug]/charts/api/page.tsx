import { Button } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { TableScroll } from "@/components/table-scroll";
import { createApiKeyAction, revokeApiKeyForm } from "@/features/charts/actions";
import { ApiKeyForm } from "@/features/charts/api-key-form";
import { chartsAccess } from "@/features/charts/context";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { API_SCOPES } from "../../../../../../../../../modules/charts/api-keys";
import { CHART_TYPES, COMPARE_MODES, INTERVALS, MAX_COMPARE, PERF_COLORS, SIZE_PRESETS } from "../../../../../../../../../modules/charts/spec";

const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export default async function ChartsApiPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await chartsAccess(slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { organizationId, brandId, brandName } = access.scope;
  const db = tenantDb(organizationId);
  const base = (await currentRequest()).origin;
  const keys = access.canManage ? await db.chartApiKey.findMany({ where: { brandId }, orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }], take: 50 }) : [];
  const keyIds = keys.map((key) => key.id);
  const calls = keyIds.length ? await db.chartApiCall.findMany({ where: { keyId: { in: keyIds } }, orderBy: { createdAt: "desc" }, take: 30 }) : [];
  const dayCounts = await Promise.all(keys.map((key) => db.chartApiCall.count({ where: { keyId: key.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } })));
  const keyName = new Map(keys.map((key) => [key.id, key.name]));

  const example = `curl -s -X POST ${base}/api/v1/charts \\
  -H "Authorization: Bearer $CHART_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"ticker":"AMD","template":"promo-midnight","period":"5Y","size":"social","headline":"{gainRounded} in {span}"}'`;

  return (
    <div className="min-w-0 space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Bot API</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Bots (GrokBot, scripts) make charts with the same renderer and the same data rules as the editor. A key belongs to one brand ({brandName}). Every number on a chart comes from market data: a bot
          writes headline text with tokens like <code className="font-mono">{"{gain}"}</code>, never figures.
        </p>
      </section>

      {access.canManage ? (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-xl border border-line bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">New key</h3>
            <ApiKeyForm action={createApiKeyAction} scopes={API_SCOPES} brandName={brandName} />
          </div>
          <div className="min-w-0 rounded-xl border border-line bg-white p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Keys for {brandName}</h3>
            {keys.length ? (
              <TableScroll>
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Key</th>
                      <th className="py-2 pr-3">Scopes</th>
                      <th className="py-2 pr-3">Limit</th>
                      <th className="py-2 pr-3">Last used</th>
                      <th className="py-2 pr-3">24h</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {keys.map((key, index) => (
                      <tr key={key.id} className={key.revokedAt ? "text-muted" : ""}>
                        <td className="py-2 pr-3 font-semibold">{key.name}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{key.prefix}…</td>
                        <td className="py-2 pr-3 text-xs">{key.scopes.join(", ")}</td>
                        <td className="py-2 pr-3">{key.rateLimit}/min</td>
                        <td className="py-2 pr-3">{when(key.lastUsedAt)}</td>
                        <td className="py-2 pr-3">{dayCounts[index] ?? 0}</td>
                        <td className="py-2 text-right">
                          {key.revokedAt ? (
                            <span className="text-xs">Revoked {when(key.revokedAt)}</span>
                          ) : (
                            <form action={revokeApiKeyForm}>
                              <input type="hidden" name="keyId" value={key.id} />
                              <Button type="submit" variant="ghost" size="sm" className="text-[#b42318]">
                                Revoke
                              </Button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ) : (
              <p className="text-sm text-muted">No keys yet.</p>
            )}
            <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Recent requests</h3>
            {calls.length ? (
              <TableScroll>
                <table className="w-full min-w-[520px] text-left text-sm">
                  <tbody className="divide-y divide-line">
                    {calls.map((call) => (
                      <tr key={call.id}>
                        <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{when(call.createdAt)}</td>
                        <td className="py-1.5 pr-3">{keyName.get(call.keyId)}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {call.method} {call.path}
                        </td>
                        <td className={`py-1.5 pr-3 font-semibold ${call.status >= 400 ? "text-[#b42318]" : "text-[#067647]"}`}>{call.status}</td>
                        <td className="py-1.5 text-muted">{call.durationMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ) : (
              <p className="text-sm text-muted">No requests yet.</p>
            )}
          </div>
        </section>
      ) : (
        <p className="rounded-md border border-line bg-white px-3 py-2 text-sm text-muted">Ask a ChartBuilder admin (charts.write) for a key. Keys are created and revoked on this page.</p>
      )}

      <section className="min-w-0 space-y-4 rounded-xl border border-line bg-white p-4 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Reference</h3>
        <Doc title="Authentication">
          Send <code className="font-mono">Authorization: Bearer pcc_…</code> on every request to <code className="break-all font-mono">{base}/api/v1/charts</code>. Keys are stored hashed and shown once;
          revoke a leaked key here. Each key has a per-minute limit (429 with <code className="font-mono">Retry-After</code> when exceeded) and scopes:
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(API_SCOPES).map(([scope, help]) => (
              <li key={scope}>
                <code className="font-mono">{scope}</code>: {help}
              </li>
            ))}
          </ul>
        </Doc>
        <Doc title="Endpoints">
          <TableScroll>
            <table className="w-full min-w-[560px] text-left">
              <tbody className="divide-y divide-line">
                {[
                  ["GET /api/v1/charts", "Cheat sheet: fields, sizes, tokens, your key's scopes."],
                  ["POST /api/v1/charts", "Make a chart. Returns figures, warnings and file links."],
                  ["GET /api/v1/charts/<id>", "A chart this brand made, with file links."],
                  ["POST /api/v1/charts/bulk", "Up to 100 charts, one design. Returns a batchId (202)."],
                  ["GET /api/v1/charts/batches/<id>", "Batch status, its charts, ZIP links when done."],
                  ["GET /api/v1/charts/batches/<id>/zip?format=png", "Every chart in the batch (png, jpg, svg, pdf, ai)."],
                  ["GET /api/v1/charts/templates", "Templates by slug (?full=1 adds the style)."],
                  ["GET /api/v1/charts/tickers?q=nvidia", "Symbol search: stocks, ETFs, crypto. Cached a day."],
                  ["GET /api/v1/charts/files/<token>.<ext>", "The file, no key needed (the token is the credential). ?scale=1-4, ?download=1, SVG ?fonts=embed."],
                ].map(([path, help]) => (
                  <tr key={path}>
                    <td className="py-1.5 pr-3 font-mono text-xs">{path}</td>
                    <td className="py-1.5">{help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Doc>
        <Doc title="POST /api/v1/charts body">
          Only <code className="font-mono">ticker</code> is required. <code className="font-mono">ticker</code>: AMD, BTC-USD, CPER/GLD, FRED:DGS10 or CSV (with <code className="font-mono">csv</code>).{" "}
          <code className="font-mono">template</code>: slug, id or name. <code className="font-mono">period</code> (1M…MAX) or <code className="font-mono">from</code>/<code className="font-mono">to</code>.{" "}
          <code className="font-mono">interval</code>: {INTERVALS.join(", ")} (picked from the span if left out). <code className="font-mono">extendedHours</code>: true adds pre-market and after-hours to intraday
          charts, shaded. <code className="font-mono">chartType</code>: {CHART_TYPES.join(", ")}. <code className="font-mono">size</code>: {Object.keys(SIZE_PRESETS).join(", ")}.{" "}
          <code className="font-mono">title</code>, <code className="font-mono">subtitle</code>, <code className="font-mono">headline</code> (tokens, <code className="font-mono">\n</code> for a new line),{" "}
          <code className="font-mono">footerLeft</code>, <code className="font-mono">footerRight</code>, <code className="font-mono">adjust</code> (split or total), <code className="font-mono">decimals</code> (0-2),{" "}
          <code className="font-mono">perfColors</code> ({PERF_COLORS.join(", ")}), <code className="font-mono">compare</code> (up to {MAX_COMPARE} tickers or {"{ ticker, label, color }"}),{" "}
          <code className="font-mono">compareMode</code> ({COMPARE_MODES.join(" or ")}), <code className="font-mono">projectName</code> or <code className="font-mono">projectId</code>. Or send a full{" "}
          <code className="font-mono">spec</code> (the editor&apos;s JSON).
        </Doc>
        <Doc title="Example">
          <pre className="overflow-x-auto rounded-md bg-canvas p-3 font-mono text-xs">{example}</pre>
          <p className="mt-2">
            The response has <code className="font-mono">headline</code> (as drawn), <code className="font-mono">stats</code> and <code className="font-mono">figures</code> from the data,{" "}
            <code className="font-mono">warnings</code> to pass on, and <code className="font-mono">files</code>: png, jpg, svg, svgFonts, pdf (vector) and ai (Illustrator-compatible PDF).
          </p>
        </Doc>
        <Doc title="Errors">
          400 bad field (the message names it) · 401 missing or revoked key · 403 missing scope · 404 unknown template, chart or batch · 422 no data for that ticker or range · 429 rate limit.
        </Doc>
      </section>
    </div>
  );
}

function Doc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1 font-semibold text-ink">{title}</h4>
      <div className="min-w-0 text-ink">{children}</div>
    </div>
  );
}
