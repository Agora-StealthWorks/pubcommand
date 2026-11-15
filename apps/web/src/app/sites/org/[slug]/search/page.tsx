import { PageHeader } from "@/components/ui";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q ?? "";
  return (
    <div>
      <PageHeader title="Search" description="Global search is a stub in Phase 1. It does not query module content." />
      <form action="/search" className="mb-4">
        <input name="q" defaultValue={query} className="h-10 w-full max-w-lg rounded-md border border-line px-3" />
      </form>
      <p className="text-sm text-muted">{query ? `No results for “${query}”.` : "Enter a query."}</p>
    </div>
  );
}
