import { redirect } from "next/navigation";

/** Publication Setup moved under Settings. Old links and bookmarks land on the same page there. */
export default async function MovedPublicationSetup({
  params,
  searchParams,
}: {
  params: Promise<{ rest?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { rest = [] } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const path = ["/settings/publication-setup", ...rest.map(encodeURIComponent)].join("/");
  redirect(query.size ? `${path}?${query.toString()}` : path);
}
