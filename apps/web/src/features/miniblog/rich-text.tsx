"use client";

import { RichTextEditor } from "@/components/rich-text-editor";
import { uploadPostImage } from "./actions";

/** The Mini-Blog rich-text field: the shared WYSIWYG editor, with image uploads stored on this Mini-Blog. */
export function MiniBlogRichText({ siteId, id, name, defaultValue, minHeight = 240, disabled }: { siteId: string; id: string; name: string; defaultValue: string; minHeight?: number; disabled?: boolean }) {
  const upload = async (file: File) => {
    const body = new FormData();
    body.set("siteId", siteId);
    body.set("file", file);
    return uploadPostImage(body);
  };
  return <RichTextEditor id={id} name={name} defaultValue={defaultValue} onUploadImage={upload} minHeight={minHeight} disabled={disabled} />;
}
