import { GET as orgGET } from "@/app/sites/org/[slug]/intel/export/route";
import { withConsoleSlug } from "@/lib/console-params";

/** The admin console's copy of the Intel CSV export (VidRipper's Export CSV). */
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(request: Request, context: { params: Promise<any> }) {
  return orgGET(request, { params: withConsoleSlug(context.params) });
}
