import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { researchContext } from "@/features/research/context";

export default async function ResearchLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await researchContext(slug);
  if (!context.ok) {
    if (context.status === 404) notFound();
    return <Denied title={context.error} />;
  }
  return <div className="mx-auto max-w-6xl">{children}</div>;
}
