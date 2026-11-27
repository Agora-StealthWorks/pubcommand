"use client";

import { useState } from "react";
import { HexColorInput } from "@/components/hex-color-input";
import { THEMES, themeById, type ThemeId } from "../../../../../modules/miniblog/themes";
import { BlogHeader, LookRoot, PostArticle, TLetterFooter, TextAd, lookFrom, type Look } from "./article";

export type SamplePost = { title: string; date: string; bodyHtml: string; actionToTake: string | null; actionSecondary: string | null; buttonText: string | null };

const SAMPLE: SamplePost = {
  title: "Three charts to watch this week",
  date: "November 25, 2026",
  bodyHtml: "<p>Good morning. Here is what moved overnight and the one setup we are watching into the open.</p><p>Rates are steady, and the leaders are holding their breakout levels.</p>",
  actionToTake: "Watch the open; set an alert at the prior high.",
  actionSecondary: "Not personal advice. Do your own research.",
  buttonText: "Read the full note",
};

/** A small, non-interactive picture of one theme (in its own default colors). */
function ThemeThumb({ look, name }: { look: Look; name: string }) {
  return (
    <div aria-hidden className="pointer-events-none h-36 overflow-hidden rounded-md border border-line">
      <LookRoot look={look}>
        <div style={{ background: look.headerBg, color: look.headerText, padding: "7px 0", textAlign: "center", fontSize: 10, fontWeight: 700, letterSpacing: ".08em" }}>{name.toUpperCase()}</div>
        <div style={{ padding: 8 }}>
          <div style={{ background: look.theme.cardBg, border: `1px solid ${look.theme.cardBorder}`, borderRadius: Math.min(look.theme.radius, 8), padding: 8 }}>
            <div style={{ color: look.theme.muted, fontSize: 8 }}>Nov 25, 2026</div>
            <div style={{ color: look.titleColor, fontSize: 11, fontWeight: 700, lineHeight: 1.2, margin: "2px 0 5px" }}>Three charts to watch</div>
            <div style={{ height: 4, background: look.theme.muted, opacity: 0.35, borderRadius: 2, marginBottom: 3 }} />
            <div style={{ height: 4, width: "80%", background: look.theme.muted, opacity: 0.35, borderRadius: 2, marginBottom: 6 }} />
            {look.theme.action === "tletter" ? (
              <div style={{ background: look.theme.adBg, borderRadius: 4, padding: 5, fontSize: 8, fontWeight: 700, color: look.theme.actionInk }}>Action to take</div>
            ) : (
              <div style={{ border: `1.5px solid ${look.accentColor}`, borderRadius: 4, padding: 5, fontSize: 8, fontWeight: 700, color: look.accentColor }}>ACTION TO TAKE</div>
            )}
            <div style={{ margin: "6px auto 0", width: 60, height: 12, borderRadius: 3, background: look.buttonColor }} />
          </div>
        </div>
      </LookRoot>
    </div>
  );
}

/**
 * Settings → Look for one Mini-Blog: pick a theme (each shown as a preview),
 * then fine-tune the header, link, button and page colors and logo size, with a live
 * preview of a post page. Writes hidden fields for the settings form.
 */
export function LookEditor({
  initial,
  logoSrc,
  siteName,
  companyName,
  sample,
  followBrand,
  disabled,
}: {
  initial: { theme: string; headerBg: string; accentColor: string; logoHeight: number; pageBg: string | null; buttonColor: string | null };
  logoSrc: string | null;
  siteName: string;
  companyName: string;
  sample: SamplePost | null;
  followBrand: boolean;
  disabled?: boolean;
}) {
  const [theme, setTheme] = useState<ThemeId>(themeById(initial.theme).id);
  const [headerBg, setHeaderBg] = useState(initial.headerBg);
  const [accentColor, setAccentColor] = useState(initial.accentColor);
  const [logoHeight, setLogoHeight] = useState(initial.logoHeight);
  // null = the theme's page color / the link color.
  const [pageBg, setPageBg] = useState<string | null>(initial.pageBg);
  const [buttonColor, setButtonColor] = useState<string | null>(initial.buttonColor);
  // Remount the color fields when a theme or a reset changes them.
  const [colorKey, setColorKey] = useState(0);
  const look = lookFrom({ theme, headerBg, accentColor, logoHeight, pageBg, buttonColor });
  const post = sample ?? SAMPLE;

  const pick = (id: ThemeId) => {
    setTheme(id);
    if (!followBrand) {
      const preset = themeById(id);
      setHeaderBg(preset.headerBg);
      setAccentColor(preset.accent);
    }
    setPageBg(null);
    setButtonColor(null);
    setColorKey((key) => key + 1);
  };
  const reset = (set: (value: null) => void) => {
    set(null);
    setColorKey((key) => key + 1);
  };

  return (
    <div className="space-y-5">
      <input type="hidden" name="theme" value={theme} />
      <div>
        <p className="text-sm font-semibold">Theme</p>
        <p className="text-xs text-muted">Pick a starting look. Picking one resets the colors to its own; change them below.</p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label="Theme">
          {THEMES.map((item) => {
            const active = item.id === theme;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => pick(item.id)}
                className={`min-w-0 rounded-lg border-2 bg-white p-2 text-left transition disabled:opacity-60 ${active ? "border-accent ring-2 ring-[#c7d7fe]" : "border-line hover:border-[#98a2b3]"}`}
              >
                <ThemeThumb look={lookFrom({ theme: item.id, headerBg: item.headerBg, accentColor: item.accent, logoHeight: 30 })} name={item.name} />
                <span className="mt-2 block text-sm font-semibold">
                  {item.name}
                  {active ? <span className="ml-1 text-xs font-semibold text-accent">· Selected</span> : null}
                </span>
                <span className="block text-xs leading-snug text-muted">{item.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <input type="hidden" name="pageBg" value={pageBg ?? ""} />
      <input type="hidden" name="buttonColor" value={buttonColor ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={`min-w-0 ${followBrand ? "opacity-60" : ""}`}>
          <label htmlFor="headerBg" className="text-sm font-semibold">
            Header color
          </label>
          <div className="mt-1">
            <HexColorInput key={`h-${colorKey}`} id="headerBg" name="headerBg" defaultValue={headerBg} label="Header color" onChange={setHeaderBg} />
          </div>
        </div>
        <div className={`min-w-0 ${followBrand ? "opacity-60" : ""}`}>
          <label htmlFor="accentColor" className="text-sm font-semibold">
            Link color
          </label>
          <div className="mt-1">
            <HexColorInput key={`a-${colorKey}`} id="accentColor" name="accentColor" defaultValue={accentColor} label="Link color" onChange={setAccentColor} />
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor="buttonColorPick" className="text-sm font-semibold">
            Button color
          </label>
          <div className="mt-1">
            <HexColorInput key={`b-${colorKey}-${buttonColor ? "own" : accentColor}`} id="buttonColorPick" name="buttonColorPick" defaultValue={look.buttonColor} label="Button color" onChange={setButtonColor} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {buttonColor ? (
              <button type="button" className="font-semibold text-accent" disabled={disabled} onClick={() => reset(setButtonColor)}>
                Use the link color
              </button>
            ) : (
              "Same as the link color."
            )}
          </p>
        </div>
        <div className="min-w-0">
          <label htmlFor="pageBgPick" className="text-sm font-semibold">
            Page background
          </label>
          <div className="mt-1">
            <HexColorInput key={`p-${colorKey}`} id="pageBgPick" name="pageBgPick" defaultValue={look.pageBg} label="Page background" onChange={setPageBg} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {pageBg ? (
              <button type="button" className="font-semibold text-accent" disabled={disabled} onClick={() => reset(setPageBg)}>
                Use the theme's background
              </button>
            ) : (
              "The color around the content box. Theme default now."
            )}
          </p>
        </div>
        <div className="min-w-0">
          <label htmlFor="logoHeight" className="text-sm font-semibold">
            Logo size <span className="font-normal text-muted">{logoHeight}px</span>
          </label>
          <input id="logoHeight" name="logoHeight" type="range" min={16} max={120} value={logoHeight} disabled={disabled} onChange={(event) => setLogoHeight(Number(event.target.value))} className="mt-3 w-full accent-accent" />
        </div>
      </div>
      {followBrand ? <p className="text-xs text-muted">“Use the brand look” is on, so the header and link colors and the logo come from the brand when you save. Logo size, button color and page background stay yours. Turn it off to use your own header and link colors.</p> : null}

      <div>
        <p className="text-sm font-semibold">Live preview</p>
        <p className="text-xs text-muted">{sample ? "Your latest post" : "A sample post"} in this look. Updates as you change it.</p>
        <div className="mt-2 max-h-[640px] overflow-auto rounded-xl border border-line shadow-sm">
          <LookRoot look={look}>
            <BlogHeader look={look} logoSrc={logoSrc} name={siteName} href={null} />
            <div className="mb-wrap">
              <div className="mb-stack">
                <TextAd text="Sponsored: this is where a text ad shows when a post has one." href="#" />
                <PostArticle
                  look={look}
                  date={post.date}
                  title={post.title}
                  bodyBefore={post.bodyHtml}
                  bodyAfter={null}
                  contentAd={null}
                  actionToTake={post.actionToTake}
                  actionSecondary={post.actionSecondary}
                  button={post.buttonText ? { text: post.buttonText, href: "#" } : null}
                />
              </div>
              {look.theme.footer === "tletter" ? (
                <div style={{ marginTop: 26 }}>
                  <TLetterFooter siteName={siteName} companyName={companyName} archives={[{ href: "#", title: "An older post", date: "November 24, 2026" }]} />
                </div>
              ) : null}
            </div>
            {look.theme.footer === "classic" ? (
              <footer className="mb-classic-foot">
                <p>
                  © {new Date().getFullYear()} {companyName}
                </p>
              </footer>
            ) : null}
          </LookRoot>
        </div>
      </div>
    </div>
  );
}
