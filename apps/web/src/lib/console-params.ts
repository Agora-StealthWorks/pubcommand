import { CONSOLE_ORG_SLUG } from "./console-workspace";

/**
 * The admin console mounts some org apps' pages (Promo Analyzer, VidRipper) at
 * the same paths. Those pages read `slug` from their params, so the console's
 * copies add the console workspace's slug.
 */
export async function withConsoleSlug<T extends object>(params: Promise<T> | undefined): Promise<T & { slug: string }> {
  return { ...((await params) ?? ({} as T)), slug: CONSOLE_ORG_SLUG };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = { params?: Promise<any>; searchParams?: Promise<any>; children?: React.ReactNode };

/** Props for an org page or layout, as the console copy received them, with the slug added. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function consoleProps(props: AnyProps): any {
  return { ...props, params: withConsoleSlug(props.params) };
}
