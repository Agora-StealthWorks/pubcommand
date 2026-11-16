import { aiConfigured } from "@pubcommand/ai";
import { can } from "@pubcommand/core";
import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { createPromo } from "@/features/promos/actions";
import { PromoDetailsFields } from "@/features/promos/details-fields";
import { getOrgContext } from "@/lib/org";

export default async function NewPromoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const writable = can(ctx.subject, "promo.write", ctx.scope);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Analyze a promo</h1>
      <p className="mt-1 text-sm text-muted">
        Upload a sales letter, VSL or webinar script for {ctx.brand?.name}. You get the headline and 4 U&apos;s, outline,
        16-Word Sales Letter review, CUB highlights, offer, stock tease and a score in about a minute. Each review also
        teaches this brand&apos;s Brain.
      </p>
      <div className="mt-4">
        <Flash error={query.error} notice={query.notice} />
        {!aiConfigured() ? (
          <p className="mb-4 rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
            The AI key is not set yet, so uploads are saved but not analyzed. Add <code>ANTHROPIC_API_KEY</code> in Railway,
            then press Re-analyze on each promo.
          </p>
        ) : null}
      </div>
      {writable ? (
        <form action={createPromo} className="space-y-5 rounded-xl border border-line bg-white p-5">
          <div>
            <Label htmlFor="promo-file">Promo file</Label>
            <input
              id="promo-file"
              name="file"
              type="file"
              accept=".docx,.pdf,.txt,.md"
              className="mt-1 block w-full rounded-md border border-dashed border-line bg-canvas px-3 py-6 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
            />
            <p className="mt-1 text-xs text-muted">.docx or .pdf up to 50 MB. Scanned PDFs are read by the AI.</p>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-accent">…or paste the copy</summary>
            <Textarea name="pasted" rows={10} className="mt-2" placeholder="Paste the full promo copy" />
          </details>
          <div>
            <Label htmlFor="promo-title">Title</Label>
            <Input id="promo-title" name="title" maxLength={200} placeholder="Defaults to the file name" />
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-accent">Details (optional — the AI fills blanks)</summary>
            <div className="mt-3">
              <PromoDetailsFields />
            </div>
          </details>
          <Button type="submit" className="w-full sm:w-auto">
            Upload and analyze
          </Button>
        </form>
      ) : (
        <p className="rounded-lg border border-line bg-white p-5 text-sm text-muted">You can view reviews but not upload. Ask an admin for promo.write.</p>
      )}
    </div>
  );
}
