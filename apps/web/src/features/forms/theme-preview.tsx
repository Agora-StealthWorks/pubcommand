"use client";

import { useEffect, useState } from "react";
import { resolveTheme } from "../../../../../modules/forms/theme";
import type { ResolvedTheme } from "../../../../../modules/forms/types";
import { FormHeader } from "./renderer";

type Props = {
  /** id of the theme <form> whose fields drive the preview. */
  formId: string;
  brandName: string;
  /** The saved uploaded logo (authenticated route), if the theme has one. */
  uploadedLogoSrc: string | null;
  /** The saved theme, shown until the form has been read in the browser. */
  initial: ResolvedTheme;
};

function readString(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Header preview that follows the theme form as it is edited, before saving.
 * Uses the same resolveTheme + FormHeader as the public form.
 */
export function LiveThemePreview({ formId, brandName, uploadedLogoSrc, initial }: Props) {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    let objectUrl: string | null = null;
    let objectFile: File | null = null;

    const update = () => {
      const data = new FormData(form);
      const file = data.get("logo");
      const hasFile = file instanceof File && file.size > 0 && file.type.startsWith("image/");
      if (hasFile && file !== objectFile) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(file);
        objectFile = file;
      } else if (!hasFile && objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        objectFile = null;
      }
      const removeUploaded = data.get("removeLogo") === "on";
      const logoUrl = readString(data, "logoUrl");
      // Same precedence as saving: removing the upload wins, then a new upload, then the saved upload, then the URL.
      const uploaded = removeUploaded ? null : (objectUrl ?? uploadedLogoSrc);
      const logoSrc = uploaded ?? (/^https?:\/\/\S+\.\S+/i.test(logoUrl) ? logoUrl : null);
      const height = Number(readString(data, "logoHeight"));
      setTheme(
        resolveTheme(
          {
            logoSrc,
            logoHeight: Number.isFinite(height) && height > 0 ? height : null,
            headerSize: readString(data, "headerSize") || "standard",
            barColor: readString(data, "barColor"),
            accentColor: readString(data, "accentColor"),
            privacyPolicyUrl: readString(data, "privacyPolicyUrl"),
            companyName: readString(data, "companyName"),
            footerText: readString(data, "footerText"),
          },
          brandName,
        ),
      );
    };

    update();
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [formId, brandName, uploadedLogoSrc]);

  return <FormHeader theme={theme} />;
}
