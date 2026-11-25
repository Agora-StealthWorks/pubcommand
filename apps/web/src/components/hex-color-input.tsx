"use client";

import { useState } from "react";

function normalize(input: string): string | null {
  const raw = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split("").map((c) => c + c).join("")}`;
  return null;
}

/**
 * A color field you can pick or type as a hex code (#7C3AED, 7c3aed or #73e). The swatch and the
 * code stay in step; the form receives `name` as #rrggbb (the last valid code typed or picked).
 */
export function HexColorInput({
  name,
  id,
  defaultValue,
  label,
  className = "",
  onChange,
}: {
  name: string;
  id?: string;
  defaultValue: string;
  /** Accessible name for the swatch and the code box. */
  label: string;
  className?: string;
  /** Called with #rrggbb whenever a valid color is picked or typed (live previews). */
  onChange?: (hex: string) => void;
}) {
  const start = normalize(defaultValue) ?? "#000000";
  const [color, setColor] = useState(start);
  const [text, setText] = useState(start.toUpperCase());
  const valid = normalize(text) !== null;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <input type="hidden" name={name} value={color} />
      <input
        type="color"
        aria-label={`${label}: pick a color`}
        value={color}
        onChange={(e) => {
          setColor(e.target.value);
          setText(e.target.value.toUpperCase());
          onChange?.(e.target.value);
        }}
        className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-line bg-white p-1"
      />
      <input
        id={id}
        type="text"
        aria-label={`${label}: hex code`}
        aria-invalid={!valid}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={7}
        placeholder="#1D4ED8"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const hex = normalize(e.target.value);
          if (hex) {
            setColor(hex);
            onChange?.(hex);
          }
        }}
        onBlur={() => setText(color.toUpperCase())}
        className={`pc-control h-11 w-full min-w-0 font-mono uppercase ${valid ? "" : "border-[#b42318]"}`}
      />
    </div>
  );
}
