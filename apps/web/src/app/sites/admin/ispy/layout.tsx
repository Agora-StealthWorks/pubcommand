import { Denied } from "@/components/ui";
import { ispyStaff } from "@/features/ispy/console-auth";
import { IspyNav } from "@/features/ispy/console-ui";
import { ispyDb } from "@/features/ispy/db";
import { currentRequest } from "@/lib/request";

/** Admin → ISpy. Every page and action re-checks platform.ispy.manage itself. */
export default async function IspyConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await ispyStaff();
  if (!staff) return <Denied title="ISpy needs the platform.ispy.manage permission" />;
  const [request, counts] = await Promise.all([
    currentRequest(),
    ispyDb(async (tx) => ({
      candidates: await tx.ispyListCandidate.count({ where: { status: "PENDING" } }),
      reports: await tx.ispyReport.count({ where: { status: "OPEN" } }),
    })),
  ]);
  return (
    <div className="min-w-0">
      <div className="mb-3">
        <h1 className="text-2xl font-semibold tracking-tight">ISpy</h1>
        <p className="text-sm text-muted">The shared registry behind every organization&apos;s ISpy feed: publishers, publications, lists, inboxes, routing, approvals and access. Every change is audited.</p>
      </div>
      <IspyNav pathname={request.pathname} counts={counts} />
      {children}
    </div>
  );
}
