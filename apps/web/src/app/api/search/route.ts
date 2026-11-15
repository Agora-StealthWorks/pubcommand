import { readSession } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await readSession();
  if (!session.user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ query, results: [] });
}
