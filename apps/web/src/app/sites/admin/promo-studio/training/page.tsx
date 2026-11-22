import OrgPage from "@/app/sites/org/[slug]/promo-studio/training/page";
import { consoleProps } from "@/lib/console-params";

/** The admin console's copy of this org page; it runs in the console workspace. */
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ConsolePage(props: any) {
  return OrgPage(consoleProps(props));
}
