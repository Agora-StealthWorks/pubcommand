import { RegistryPage } from "@/features/intel/registry-page";

export default async function IntelListsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  return <RegistryPage slug={slug} kind="list" search={await searchParams} />;
}
