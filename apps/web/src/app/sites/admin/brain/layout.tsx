import { Denied } from "@/components/ui";
import { BrainSubnav } from "@/features/main-brain/parts";
import { brainStaff } from "@/features/main-brain/staff";
import { currentRequest } from "@/lib/request";
import "@/features/brain/brain.css";

/** Main Brain (platform staff only). Every page and action re-checks platform.brain.manage itself. */
export default async function MainBrainLayout({ children }: { children: React.ReactNode }) {
  const staff = await brainStaff();
  if (!staff) return <Denied title="The main Brain needs the platform.brain.manage permission" />;
  const request = await currentRequest();
  return (
    <div className="min-w-0">
      <BrainSubnav path={request.pathname} />
      {children}
    </div>
  );
}
