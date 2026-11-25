import { redirect } from "next/navigation";

/** Audit moved under Usage. */
export default function OldAuditPage() {
  redirect("/usage/audit");
}
