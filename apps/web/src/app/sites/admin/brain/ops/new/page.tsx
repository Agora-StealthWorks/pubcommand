import { Denied, Flash, PageHeader } from "@/components/ui";
import { brainStaff } from "@/features/main-brain/staff";
import { OpsNoteForm } from "../ops-form";

export default async function NewOpsNotePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  return (
    <div className="max-w-3xl">
      <PageHeader title="New Operations Brain note" description="Something you learned about how the business runs: a tactic, a pattern in the copy, a trend, how a team works." />
      <Flash error={query.error} />
      <OpsNoteForm />
    </div>
  );
}
