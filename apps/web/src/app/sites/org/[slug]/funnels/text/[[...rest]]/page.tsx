import { redirect } from "next/navigation";

/** Text-letter sites moved to their own app, Mini-Blog. Old admin links land on the same screen there. */
export default async function MovedToMiniBlog({ params }: { params: Promise<{ rest?: string[] }> }) {
  const { rest = [] } = await params;
  const tail = rest.filter((part) => /^[A-Za-z0-9-]{1,64}$/.test(part)).join("/");
  redirect(tail ? `/mini-blog/${tail}` : "/mini-blog");
}
