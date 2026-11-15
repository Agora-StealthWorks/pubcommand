import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-line bg-white shadow-sm", className)} {...props} />;
}

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "ok" | "warn" | "danger" }) {
  const tones = {
    neutral: "bg-canvas text-muted",
    accent: "bg-[#dbe7ff] text-[#1e3a8a]",
    ok: "bg-[#dcfae6] text-[#067647]",
    warn: "bg-[#fef0c7] text-[#b54708]",
    danger: "bg-[#fee4e2] text-[#b42318]",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}
      {...props}
    />
  );
}
