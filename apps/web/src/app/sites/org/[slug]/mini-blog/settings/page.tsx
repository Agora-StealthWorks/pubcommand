import { Button, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { saveMediums } from "@/features/miniblog/actions";
import { loadMediums } from "@/features/miniblog/data";
import { Field, Section } from "@/features/miniblog/fields";
import { miniblogAccess } from "@/features/miniblog/guard";
import { DEFAULT_MEDIUMS, subscribeKind } from "../../../../../../../../../modules/miniblog/mediums";

const KIND_LABEL = { email: "email sign-up form", none: "no sign-up form" } as const;

/** Mini-Blog → App settings (admins): the mediums a Mini-Blog can be. */
export default async function MiniBlogSettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await miniblogAccess(slug, "miniblog.manage");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const mediums = await loadMediums(access.ctx.resolved.id);
  return (
    <div className="max-w-2xl">
      <Link href="/mini-blog" className="text-sm font-semibold text-accent">
        ← Mini-Blogs
      </Link>
      <PageHeader title="Mini-Blog app settings" description="Settings for every Mini-Blog in this organization." />
      <Flash error={query.error} notice={query.notice} />
      <form action={saveMediums}>
        <Section title="Mediums" description="What a new Mini-Blog (T-Letter) asks for: how readers get it. It is the issue type of its posts on the Calendar, and Email mediums get an email sign-up form.">
          <Field label="Mediums, one per line" htmlFor="mediums" hint={`Empty restores the defaults: ${DEFAULT_MEDIUMS.join(", ")}. Removing a medium leaves Mini-Blogs that use it unchanged.`}>
            <Textarea id="mediums" name="mediums" defaultValue={mediums.join("\n")} className="min-h-32" />
          </Field>
          <ul className="space-y-1 text-sm">
            {mediums.map((medium) => (
              <li key={medium}>
                <span className="font-semibold">{medium}</span> <span className="text-muted">· {KIND_LABEL[subscribeKind(medium)]}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">A medium with “email” or “newsletter” in its name gets the email sign-up form. Every other medium, SMS included, publishes posts with no sign-up form: Mini-Blogs never collect phone numbers.</p>
          <Button type="submit">Save</Button>
        </Section>
      </form>
    </div>
  );
}
