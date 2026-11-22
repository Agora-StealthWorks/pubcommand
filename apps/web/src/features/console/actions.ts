"use server";

import { appendPlatformAudit } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { requireBrainStaff } from "../main-brain/staff";
import { reframeMainBrainNotes } from "../main-brain/lens";
import { copyPromosIntoConsole, copyVideosIntoConsole, learnUpEverywhere, syncPromosToMasterBrain } from "./past-data";

const BACK = "/brain/past";

function go(kind: "error" | "notice", message: string): never {
  redirect(`${BACK}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * One click: every promo analysis and app-taught note (deleted organizations
 * included) into the Master Brain, then a batch of promos and videos copied
 * into the console's Promo Analyzer and VidRipper. Safe to run again: it only
 * fills what is missing. Large backlogs take a few clicks (batches).
 */
export async function bringPastDataOver() {
  const staff = await requireBrainStaff();
  try {
    const learned = await learnUpEverywhere();
    const promoNotes = await syncPromosToMasterBrain();
    const promos = await copyPromosIntoConsole({ limit: 40 });
    const videos = await copyVideosIntoConsole({ limit: 60 });
    await reframeMainBrainNotes();
    await appendPlatformAudit({
      actorId: staff.userId,
      action: "console.past_data.brought_over",
      targetType: "platform",
      targetId: null,
      metadata: { learned: learned.created ?? 0, promoNotes: promoNotes.created ?? 0, promos: promos.copied ?? 0, videos: videos.copied ?? 0 },
    });
    const left = (promos.remaining ?? 0) + (videos.remaining ?? 0);
    go(
      "notice",
      `Master Brain: ${(learned.created ?? 0) + (promoNotes.created ?? 0)} notes added. Console: ${promos.copied} promos and ${videos.copied} videos copied.` +
        (left ? ` ${left} more to copy — press the button again.` : " Everything is over."),
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    go("error", error instanceof Error ? error.message : "Bringing the past data over failed.");
  }
}
