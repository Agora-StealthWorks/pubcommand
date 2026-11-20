import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { PublicationForm } from "@/features/pubsetup/forms";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { getPublication } from "@/features/pubsetup/read";

export default async function EditPublicationPage({ params, searchParams }: { params: Promise<{ slug: string; publicationId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug, publicationId } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const pub = await getPublication(access.ctx.resolved.id, access.ctx.brand.id, publicationId);
  if (!pub || pub.id !== publicationId) notFound();
  return (
    <div>
      <Link href={`/settings/publication-setup/publications/${pub.id}`} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">
        ← {pub.name}
      </Link>
      <h2 className="mb-4 text-lg font-semibold">Edit {pub.name}</h2>
      <Flash error={query.error} />
      <PublicationForm pub={pub} />
    </div>
  );
}
