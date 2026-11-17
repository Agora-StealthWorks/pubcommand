import { redirect } from "next/navigation";

/** The module slug is "miniblog"; the app lives at /mini-blog. */
export default function MiniBlogSlug() {
  redirect("/mini-blog");
}
