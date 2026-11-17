import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicForm } from "@/features/forms/public";
import { ClosedForm } from "@/features/forms/closed";
import { FormRenderer } from "@/features/forms/renderer";
import { currentRequest } from "@/lib/request";

type Params = Promise<{ slug: string; formSlug: string }>;

/** The public form: https://{org}.pubcommand.com/f/<form>. No sign-in. */
async function load(params: Params) {
  const { slug, formSlug } = await params;
  const request = await currentRequest();
  if (request.site.kind !== "org" || request.site.slug !== slug) return null;
  return { slug, formSlug, loaded: await loadPublicForm(slug, formSlug) };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const result = await load(params);
  if (!result || result.loaded.kind === "missing") return { title: "Form not found" };
  return { title: { absolute: result.loaded.kind === "open" ? result.loaded.form.title : result.loaded.title } };
}

export default async function PublicFormPage({ params }: { params: Params }) {
  const result = await load(params);
  if (!result || result.loaded.kind === "missing") notFound();
  const { loaded, formSlug } = result;
  if (loaded.kind === "closed") return <ClosedForm title={loaded.title} message={loaded.message} theme={loaded.theme} />;
  return <FormRenderer form={loaded.form} theme={loaded.theme} mode="public" submitUrl={`/f/${formSlug}/submit`} progressUrl={`/f/${formSlug}/progress`} />;
}
