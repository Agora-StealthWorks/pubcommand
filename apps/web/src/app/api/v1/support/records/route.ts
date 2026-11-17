import { withAgent } from "@/features/support/agent-api";
import { recordResponse } from "@/features/support/agent-routes";

export const dynamic = "force-dynamic";

/** get_record by ?id= (what a webhook tool sends). */
const handler = withAgent("get_record", async (ctx, params) => recordResponse(ctx, params.id ?? ""));

export const GET = handler;
export const POST = handler;
