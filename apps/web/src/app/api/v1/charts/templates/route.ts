import { apiJson, templatesFor, withApi } from "@/features/charts/api";

export const dynamic = "force-dynamic";

/** Templates by slug. `?full=1` includes each template's style JSON. */
export const GET = withApi("charts.templates", async (ctx, request) => {
  const full = new URL(request.url).searchParams.get("full") === "1";
  const templates = await templatesFor(ctx.organizationId);
  return apiJson(200, {
    templates: templates.map((t) => ({
      slug: t.slug ?? t.id,
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      chartType: t.style.chartType,
      design: t.style.design,
      ...(full ? { style: t.style } : {}),
    })),
  });
});
