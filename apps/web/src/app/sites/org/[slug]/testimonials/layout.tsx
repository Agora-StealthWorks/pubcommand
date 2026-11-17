import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { testimonialsPage } from "@/features/testimonials/guard";
import { currentRequest } from "@/lib/request";

export default async function TestimonialsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await testimonialsPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { pathname } = await currentRequest();
  const tabs = [
    ["/testimonials", "All testimonials", true],
    ["/testimonials/new", "Add", access.can.write],
    ["/testimonials/capture", "Public capture links", access.can.approve],
  ] as const;
  const active = pathname.startsWith("/testimonials/new") ? "/testimonials/new" : pathname.startsWith("/testimonials/capture") ? "/testimonials/capture" : "/testimonials";
  return (
    <div className="min-w-0">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Testimonials</h1>
        <p className="text-sm text-muted">{access.ctx.brand.name}&apos;s reader testimonials. Only approved ones appear in the wiki.</p>
      </div>
      <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Testimonials sections">
        {tabs
          .filter(([, , show]) => show)
          .map(([href, label]) => (
            <Link key={href} href={href} className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${active === href ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>
              {label}
            </Link>
          ))}
      </nav>
      {children}
    </div>
  );
}
