import { tenantDb } from "@pubcommand/db";
import { intelAccess } from "@/features/intel/context";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; emailId: string }> }) {
  const { slug, emailId } = await params;
  const access = await intelAccess("read", slug);
  if (!access.ok || !/^[0-9a-f-]{36}$/i.test(emailId)) return new Response("Not found", { status: 404 });
  const email = await tenantDb(access.scope.organizationId).intelEmail.findFirst({
    where: { id: emailId, brandId: access.scope.brand.id, deletedAt: null },
    select: { raw: true, subject: true },
  });
  if (!email?.raw) return new Response("Not found", { status: 404 });
  const filename = `${email.subject.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 80) || "email"}.eml`;
  return new Response(Buffer.from(email.raw), {
    headers: {
      // Never rendered by the browser: it is someone else's HTML.
      "content-type": "message/rfc822",
      "content-length": String(email.raw.byteLength),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
