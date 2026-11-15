"use client";

import { useEffect, useState } from "react";

export function SlugField({ current }: { current: string }) {
  const [slug, setSlug] = useState(current);
  const [message, setMessage] = useState("This becomes the subdomain.");

  useEffect(() => {
    const handle = setTimeout(() => {
      const value = slug.trim().toLowerCase();
      if (!value) return;
      void fetch(`/api/slugs/availability?slug=${encodeURIComponent(value)}`)
        .then((response) => response.json())
        .then((body: { available?: boolean; reason?: string }) => {
          if (body.reason === "unchanged") setMessage("This is the current slug.");
          else if (body.available) setMessage("Available.");
          else if (body.reason === "reserved") setMessage("That name is reserved.");
          else if (body.reason === "history") setMessage("That slug still redirects and cannot be reused.");
          else if (body.reason === "taken") setMessage("That slug is taken.");
          else setMessage("Use 3-40 lowercase letters, numbers, or hyphens.");
        })
        .catch(() => setMessage("Could not check availability."));
    }, 250);
    return () => clearTimeout(handle);
  }, [slug]);

  return (
    <label className="block text-sm font-semibold">
      Public slug
      <input
        name="slug"
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
        className="mt-1 h-11 min-h-11 w-full max-w-full rounded-md border border-line px-3 font-normal"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <span className="mt-1 block font-normal text-muted">{message}</span>
    </label>
  );
}
