"use client";

import { organizationPublicUrl, slugifyName, validateSlug } from "@pubcommand/core";
import { Input } from "@pubcommand/ui";
import { useEffect, useRef, useState } from "react";

export function OrgSlugField({ rootDomain }: { rootDomain: string }) {
  const [slug, setSlug] = useState("");
  const [message, setMessage] = useState("Lowercase letters, numbers, and hyphens.");
  const manual = useRef(false);

  useEffect(() => {
    const input = document.getElementById("org-name");
    if (!(input instanceof HTMLInputElement)) return;
    const sync = () => {
      if (manual.current) return;
      setSlug(slugifyName(input.value));
    };
    input.addEventListener("input", sync);
    return () => input.removeEventListener("input", sync);
  }, []);

  useEffect(() => {
    const value = slug.trim().toLowerCase();
    if (!value) {
      setMessage("Lowercase letters, numbers, and hyphens.");
      return;
    }
    const parsed = validateSlug(value);
    if (!parsed.ok) {
      setMessage(parsed.reason === "reserved" ? "That name is reserved." : "Use 3-40 lowercase letters, numbers, or hyphens.");
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(() => {
      setMessage("Checking…");
      void fetch(`/api/slugs/availability?slug=${encodeURIComponent(parsed.slug)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((body: { available?: boolean; reason?: string }) => {
          if (body.available) setMessage("Available.");
          else if (body.reason === "reserved") setMessage("That name is reserved.");
          else if (body.reason === "history") setMessage("That slug still redirects and cannot be reused.");
          else if (body.reason === "taken") setMessage("That slug is taken.");
          else if (body.reason === "unauthorized" || body.reason === "forbidden") setMessage("Sign in as staff to check availability.");
          else setMessage("Use 3-40 lowercase letters, numbers, or hyphens.");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setMessage("Could not check availability.");
        });
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [slug]);

  const preview = slug ? organizationPublicUrl(slug, rootDomain) : `https://your-org.${rootDomain.replace(/^\.+|\.+$/g, "") || "pubcommand.com"}`;

  return (
    <div>
      <label htmlFor="org-slug" className="text-sm font-semibold text-ink">
        Subdomain
      </label>
      <Input
        id="org-slug"
        name="slug"
        value={slug}
        required
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        aria-describedby="org-slug-status"
        className="mt-1"
        onChange={(event) => {
          manual.current = true;
          setSlug(event.target.value.toLowerCase());
        }}
      />
      <p id="org-slug-status" role="status" className="mt-1 text-sm text-muted">
        {message}
      </p>
      <p className="pc-break text-sm text-muted">{preview}</p>
    </div>
  );
}
