import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicForm } from "@/features/forms/public";
import { ClosedForm } from "@/features/forms/closed";
import { FormRenderer } from "@/features/forms/renderer";
import { currentRequest } from "@/lib/request";

type Params = Promise<{ slug: string; formSlug: string }>;

export const metadata: Metadata = { robots: { index: false } };

/**
 * The embeddable form, for an iframe: no header, transparent ground. It posts
 * its height ("pubcommand-form:height") and a "pubcommand-form:submitted"
 * event (no answers) to the parent, and never navigates the host page.
 */
export default async function EmbedFormPage({ params }: { params: Params }) {
  const { slug, formSlug } = await params;
  const request = await currentRequest();
  if (request.site.kind !== "org" || request.site.slug !== slug) notFound();
  const loaded = await loadPublicForm(slug, formSlug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "closed") return <ClosedForm title={loaded.title} message={loaded.message} theme={loaded.theme} embed />;
  return (
    <>
      <style>{"html,body{background:transparent!important}"}</style>
      <FormRenderer form={loaded.form} theme={loaded.theme} mode="embed" submitUrl={`/f/${formSlug}/submit`} progressUrl={`/f/${formSlug}/progress`} />
    </>
  );
}
