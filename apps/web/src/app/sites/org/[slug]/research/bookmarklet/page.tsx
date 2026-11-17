import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { researchContext } from "@/features/research/context";
import { bookmarkletCode } from "../../../../../../../../../modules/research/capture";

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default async function BookmarkletPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await researchContext(slug);
  if (!context.ok) notFound();
  const code = bookmarkletCode(context.viewer.origin);
  // React refuses javascript: links, so the drag target is plain HTML built from a fixed template and this workspace's own address.
  const anchor = `<a href="${escapeAttr(code)}" class="inline-flex min-h-11 cursor-move items-center rounded-md bg-accent px-4 text-sm font-semibold text-white" onclick="return false">Send to Research</a>`;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <nav className="text-sm">
        <Link href="/research" className="text-accent hover:underline">← Research Extractor</Link>
      </nav>
      <PageHeader
        title="The capture bookmarklet"
        description="For pages this app cannot read itself: sites that block automated readers, pages built by scripts, and articles behind a login you already have. It reads the page your browser has already shown you."
      />
      <ol className="space-y-4 rounded-xl border border-line bg-white p-5 text-sm">
        <li>
          <span className="font-semibold">1.</span> Show your browser&apos;s bookmarks bar (Ctrl+Shift+B, or ⌘⇧B on a Mac).
        </li>
        <li>
          <span className="font-semibold">2.</span> Drag this button onto the bar:
          <div className="mt-2" dangerouslySetInnerHTML={{ __html: anchor }} />
        </li>
        <li>
          <span className="font-semibold">3.</span> On any article, click it. A tab opens here: pick the project and the cards are extracted.
        </li>
      </ol>
      <section className="rounded-xl border border-line bg-white p-5 text-sm">
        <h2 className="font-semibold">Good to know</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>Select part of the page first to capture only that part.</li>
          <li>The page&apos;s address is kept, so cards link back to it.</li>
          <li>You need to be signed in here in the same browser. Allow pop-ups for the site if nothing opens.</li>
          <li>Only the text is sent, and only to this workspace. The bookmarklet holds no password or key.</li>
        </ul>
      </section>
      <section className="rounded-xl border border-line bg-white p-5 text-sm">
        <h2 className="font-semibold">Can&apos;t drag it?</h2>
        <p className="mt-1 text-muted">Make a new bookmark and paste this as its address:</p>
        <textarea readOnly value={code} rows={4} aria-label="Bookmarklet code" className="pc-control mt-2 w-full font-mono text-[11px]" />
      </section>
    </div>
  );
}
