import { redirect } from "next/navigation";

/** The module slug is "pubsetup"; the app lives at /publication-setup. */
export default function PubsetupSlug() {
  redirect("/publication-setup");
}
