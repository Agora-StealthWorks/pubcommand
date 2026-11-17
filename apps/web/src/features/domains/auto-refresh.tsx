"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the Domains page while a domain is waiting on DNS or its certificate. */
export function AutoRefresh({ everyMs = 15_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
