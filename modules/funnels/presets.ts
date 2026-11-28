/**
 * New-funnel presets. PURE. A preset only picks starting values for settings that
 * already exist (type, mode, timing, countdowns, bar, navigation, offer blocks);
 * everything stays editable afterwards and nothing is hidden or locked.
 */
import { newBlock, newBlockId, type Block } from "./blocks";
import type { LinkItem } from "./links";

export const FUNNEL_PRESETS = ["live", "evergreen", "docuseries", "microsite"] as const;
export type FunnelPreset = (typeof FUNNEL_PRESETS)[number];

export const PRESET_INFO: Record<FunnelPreset, { label: string; description: string }> = {
  live: { label: "Live challenge", description: "Live sessions at set times, then replays. Waitlist countdown before the start." },
  evergreen: { label: "Evergreen launch", description: "Pre-recorded videos that unlock on a schedule from each visitor's first visit." },
  docuseries: { label: "Docuseries: expiring episodes", description: "One episode a day, each open for 24 hours. Countdown header, episode list beside the video, offer underneath." },
  microsite: { label: "Microsite", description: "A home page built from blocks, with the modules and pages around it." },
};

export function isPreset(value: unknown): value is FunnelPreset {
  return typeof value === "string" && (FUNNEL_PRESETS as readonly string[]).includes(value);
}

/** Type and mode for the preset (the columns createFunnel always sets). */
export function presetBasics(preset: FunnelPreset): { siteType: "launch" | "microsite"; mode: "evergreen" | "live" } {
  if (preset === "microsite") return { siteType: "microsite", mode: "evergreen" };
  return { siteType: "launch", mode: preset === "live" ? "live" : "evergreen" };
}

/** Extra funnel columns for the preset ({} = the normal new-funnel defaults). */
export function presetColumns(preset: FunnelPreset): Record<string, unknown> {
  if (preset === "evergreen") return { timing: "per_viewer", progression: "scheduled" };
  if (preset !== "docuseries") return {};
  return {
    timing: "per_viewer",
    progression: "scheduled",
    accessHours: 24,
    waitlistEnabled: false,
    unlockCountdownMode: "always",
    unlockCountdownTitle: "{day} starts in…",
    lockedExpiredMsg: "{day} is no longer available. Get full access to watch every episode any time.",
    countdownStyle: "flip",
    countdownBoxBg: "#3a423e",
    countdownDigit: "#ffffff",
    lockedBoxBg: "#000000",
    lockedBoxText: "#ffffff",
    lockedBoxMinimal: true,
    navLayout: "sidebar",
    navBlurLocked: true,
    deadlineBarEnabled: true,
    deadlineBarTarget: "episode",
    deadlineBarPosition: "header",
    deadlineBarText: "Episode access expiring in:",
    deadlineBarBg: "#0a0f0d",
    deadlineBarColor: "#ffffff",
    deadlineBarDigitColor: "#3a423e",
    deadlineBarButtonText: "» Get full access",
    deadlineBarButtonUrl: "#offer",
    deadlineBarButtonBg: "#f2b43a",
    deadlineBarPages: ["day"],
  };
}

/** The offer section a docuseries starts with: headline, countdown, pricing, testimonials, FAQ, episode grid. */
export function presetOfferBlocks(preset: FunnelPreset, makeId: () => string = newBlockId): Block[] {
  if (preset !== "docuseries") return [];
  const make = <T extends Block["type"]>(type: T, patch: Partial<Extract<Block, { type: T }>> = {}) => ({ ...newBlock(type, makeId()), ...patch }) as Block;
  return [
    make("headline", { eyebrow: "On this page only", heading: "Don't miss a single episode.", accent: "Own the complete series.", sub: "" }),
    make("countdown", { heading: "Your discount expires in…", target: "episode" }),
    make("pricing"),
    make("testimonials"),
    make("faq"),
    make("episodes"),
  ];
}

/** Each new docuseries episode gets locked download teasers that point to the offer. */
export function presetDayResources(preset: FunnelPreset): LinkItem[] {
  if (preset !== "docuseries") return [];
  return ["Download transcript", "Download audio", "Download video"].map((label) => ({ label, url: "#offer", style: "locked" as const, newTab: false }));
}
