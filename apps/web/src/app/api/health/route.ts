import { readS3Config } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";

export async function GET() {
  try {
    await rawPrisma().$queryRaw`SELECT 1`;
    return Response.json({
      ok: true,
      service: "web",
      redis: process.env.REDIS_URL ? "configured" : "unset",
      storage: readS3Config() ? "configured" : "unset",
    });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
