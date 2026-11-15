import { PageHeader } from "@/components/ui";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q ?? "";
  return (
    <div>
      <PageHeader title="Search" description="Global search is a stub in Phase 1. It does not query module content." />
      <form action="/search" className="mb-4">
        <input name="q" defaultValue={query} className="h-11 min-h-11 w-full max-w-full rounded-md border border-line px-3 md:max-w-lg" />
      </form>
      <p className="pc-break text-sm text-muted">{query ? `No results for “${query}”.` : "Enter a query."}</p>
    </div>
  );
}
