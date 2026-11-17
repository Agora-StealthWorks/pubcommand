import { RegistryPage } from "@/features/intel/registry-page";

export default async function IntelTopicsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  return <RegistryPage slug={slug} kind="topic" search={await searchParams} />;
}
