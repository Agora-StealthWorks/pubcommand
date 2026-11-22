import Link from "next/link";
import { Denied } from "@/components/ui";
import { brainStaff } from "@/features/main-brain/staff";
import { currentRequest } from "@/lib/request";

/** VidRipper in the admin console: the Intel video capture, running in the console workspace. */
export default async function ConsoleIntelLayout({ children }: { children: React.ReactNode }) {
  const staff = await brainStaff();
  if (!staff) return <Denied title="VidRipper needs the platform.brain.manage permission" />;
  const { pathname } = await currentRequest();
  const tab = (href: string, label: string, active: boolean) => (
    <Link href={href} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium ${active ? "bg-[#eef2ff] text-[#1e3a8a]" : "hover:bg-canvas"}`}>
      {label}
    </Link>
  );
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">VidRipper</h1>
          <p className="text-sm text-muted">Capture videos from publishers across the industry: transcript, keyframes and the AI read. Every capture feeds the Master Brain.</p>
        </div>
        <nav className="flex gap-1" aria-label="VidRipper">
          {tab("/intel/videos", "Videos", pathname.startsWith("/intel/videos"))}
          {tab("/brain/past?show=videos", "Past videos (Master Brain)", false)}
        </nav>
      </div>
      {children}
    </div>
  );
}
