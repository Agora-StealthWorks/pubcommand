import { redirect } from "next/navigation";

/** The module slug is "pubsetup"; the app lives at /settings/publication-setup. */
export default function PubsetupSlug() {
  redirect("/settings/publication-setup");
}
