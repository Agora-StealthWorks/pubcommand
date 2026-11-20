import { currentRequest } from "@/lib/request";
import type { DayState } from "../../../../../modules/funnels/state";
import type { ViewerCookie } from "../../../../../modules/funnels/viewer";
import type { DayRow } from "./data";
import { publicBase, publicDays, readViewer, statesFor, type LoadedFunnel } from "./public";
import { funnelTheme, type FunnelTheme } from "./site-data";
import { agendaEntries } from "./home-view";
import type { AgendaPlaceholder } from "./public-view";

export type PageContext = {
  base: string;
  viewer: ViewerCookie | null;
  states: DayState[];
  /** Days safe to render: locked days carry no video id or unlock key. */
  safeDays: DayRow[];
  theme: FunnelTheme;
  homeHref: string;
  host: string;
  origin: string;
  /** Agenda entries: safe days with "list in the agenda" placeholders placed among them. */
  agenda: (DayRow | AgendaPlaceholder)[];
};

/** What every public funnel page works out first: link base, viewer, day states and the design. */
export async function pageContext(loaded: LoadedFunnel, options: { fresh?: string; presentedKeys?: Record<string, string> } = {}): Promise<PageContext> {
  const { funnel, preview, carry } = loaded;
  const base = await publicBase("l", funnel.slug);
  const viewer = await readViewer(funnel.id, preview && options.fresh === "1");
  const states = statesFor(loaded, viewer, options.presentedKeys ?? {});
  const homeHref = `${base || "/"}${carry}`;
  const [theme, request] = await Promise.all([funnelTheme(loaded.organizationId, funnel, base, homeHref), currentRequest()]);
  const safeDays = publicDays(loaded.days, states);
  return { base, viewer, states, safeDays, theme, homeHref, host: request.host, origin: request.origin, agenda: agendaEntries(safeDays, loaded.navItems) };
}
