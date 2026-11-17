"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-renders the page every few seconds while an extraction or grouping run is going. */
export function AutoRefresh({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const tick = setInterval(() => setSeconds((value) => value + 1), 1000);
    const refresh = setInterval(() => router.refresh(), everyMs);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router, everyMs]);
  return <span className="tabular-nums">{seconds}s</span>;
}
