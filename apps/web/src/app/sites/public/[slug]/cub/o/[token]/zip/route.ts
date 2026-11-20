import { roundByToken, roundZip } from "@/features/calendar/cub";
import { CUB_COLLECTOR_ENABLED } from "../../../../../../../../../../../modules/editorial/features";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  if (!CUB_COLLECTOR_ENABLED) return new Response("Not found", { status: 404 });
  const { slug, token } = await params;
  const found = await roundByToken(slug, "owner", token);
  if (!found) return new Response("Not found", { status: 404 });
  return roundZip(found.organization.id, found.round);
}
