import { redirect } from "next/navigation";

/** Jobs moved under Usage. */
export default async function OldJobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = new URLSearchParams(Object.entries(await searchParams).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  redirect(`/usage/jobs${query.size ? `?${query}` : ""}`);
}
