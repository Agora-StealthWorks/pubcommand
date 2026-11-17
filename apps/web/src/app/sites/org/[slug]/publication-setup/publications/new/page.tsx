import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { PublicationForm } from "@/features/pubsetup/forms";
import { pubsetupPage } from "@/features/pubsetup/guard";

export default async function NewPublicationPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">New publication</h2>
      <p className="mb-4 text-sm text-muted">Only name, code and status are required. Fill in the rest when you have it: the more you add, the better every app and the Brain know this publication.</p>
      <Flash error={query.error} />
      <PublicationForm />
    </div>
  );
}
