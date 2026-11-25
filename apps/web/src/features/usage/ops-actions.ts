"use server";

import { appendPlatformAudit } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { requireBrainStaff } from "@/features/main-brain/staff";
import { deleteOpsNote, saveOpsNote } from "./ops-brain";
import { writeDailyInsight, addDays, nyDay } from "./insights";
import { captureActivities } from "./capture";

const back = (path: string, kind: "error" | "notice", message: string) => `${path}?${kind}=${encodeURIComponent(message)}`;

export async function saveOpsNoteAction(formData: FormData) {
  const staff = await requireBrainStaff();
  const id = String(formData.get("id") ?? "").trim() || null;
  let saved: { id: string };
  try {
    saved = await saveOpsNote({ id, title: String(formData.get("title") ?? ""), body: String(formData.get("body") ?? ""), actorId: staff.userId, source: "staff" });
  } catch (error) {
    redirect(back(id ? `/brain/ops/${id}/edit` : "/brain/ops/new", "error", error instanceof Error ? error.message : "Could not save."));
  }
  await appendPlatformAudit({ actorId: staff.userId, action: id ? "ops_brain.note.updated" : "ops_brain.note.created", targetType: "ops_brain_note", targetId: saved.id });
  redirect(back(`/brain/ops/${saved.id}`, "notice", "Saved."));
}

export async function deleteOpsNoteAction(formData: FormData) {
  const staff = await requireBrainStaff();
  const id = String(formData.get("id") ?? "");
  await deleteOpsNote(id);
  await appendPlatformAudit({ actorId: staff.userId, action: "ops_brain.note.deleted", targetType: "ops_brain_note", targetId: id });
  redirect(back("/brain/ops", "notice", "Note deleted."));
}

/** Writes (or rewrites) yesterday's daily read now instead of waiting for the night job. */
export async function writeDailyNowAction() {
  const staff = await requireBrainStaff();
  await captureActivities();
  const result = await writeDailyInsight(addDays(nyDay(new Date()), -1));
  await appendPlatformAudit({ actorId: staff.userId, action: "ops_brain.daily.written", targetType: "ops_brain_note", targetId: null, metadata: result as never });
  redirect(back("/brain/ops", "notice", `Yesterday's read: ${result.outcome}${result.ai === "unavailable" ? " (no AI key, factual digest)" : result.ai === "failed" ? " (AI failed, factual digest)" : ""}.`));
}
