"use client";

import { useEffect } from "react";

/** An iframe cannot size itself: post the page height to the host page whenever it changes. Never navigates the host. */
export function WidgetHeight() {
  useEffect(() => {
    if (window.parent === window) return;
    const post = () => window.parent.postMessage({ type: "pubcommand-track-record:height", height: Math.ceil(document.documentElement.scrollHeight) }, "*");
    const observer = new ResizeObserver(post);
    observer.observe(document.body);
    post();
    return () => observer.disconnect();
  }, []);
  return null;
}
