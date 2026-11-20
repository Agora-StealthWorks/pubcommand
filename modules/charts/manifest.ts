import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "charts",
  slug: "charts",
  name: "ChartBuilder",
  description: "Promo and publication stock charts from real market data, with exports, projects and bulk runs.",
  nav: [{ label: "ChartBuilder", href: "/charts", permission: "charts.read" }],
  routes: [{ path: "/charts", title: "ChartBuilder" }],
  permissions: [
    { key: "charts.read", description: "Make, save and export charts", access: "write" },
    { key: "charts.write", description: "Manage chart templates and delete any project" },
  ],
  events: [{ name: "charts.chart.saved", description: "A chart was saved" }],
  jobs: [{ name: "charts.bulk", description: "Build a bulk run of charts" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { palette: { type: "string" } },
  },
  planEntitlement: "charts",
});
