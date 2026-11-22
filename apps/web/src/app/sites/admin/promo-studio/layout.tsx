import OrgLayout from "@/app/sites/org/[slug]/promo-studio/layout";
import { consoleProps } from "@/lib/console-params";

/** The admin console's copy of this org layout; it runs in the console workspace. */
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ConsoleLayout(props: any) {
  return OrgLayout(consoleProps(props));
}
