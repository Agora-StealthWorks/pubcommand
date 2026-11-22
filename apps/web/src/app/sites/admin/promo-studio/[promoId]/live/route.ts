import { GET as orgGET } from "@/app/sites/org/[slug]/promo-studio/[promoId]/live/route";
import { withConsoleSlug } from "@/lib/console-params";

/** The admin console's copy of this org route; it runs in the console workspace. */
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(request: Request, context: { params: Promise<any> }) {
  return orgGET(request, { params: withConsoleSlug(context.params) });
}
