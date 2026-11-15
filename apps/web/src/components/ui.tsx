export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (error) {
    return <p className="mb-4 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{error}</p>;
  }
  if (notice) {
    return <p className="mb-4 rounded-md border border-[#abefc6] bg-[#ecfdf3] px-3 py-2 text-sm text-[#067647]">{notice}</p>;
  }
  return null;
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
    </header>
  );
}

export function Denied({ title = "You do not have access" }: { title?: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-line bg-white p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">Your role, the organization plan, or an exclusion blocks this page.</p>
    </div>
  );
}
