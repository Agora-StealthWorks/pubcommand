import { withAgent } from "@/features/support/agent-api";
import { recordResponse } from "@/features/support/agent-routes";

export const dynamic = "force-dynamic";

/** get_record by path. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAgent("get_record", async (ctx) => recordResponse(ctx, id))(request);
}
