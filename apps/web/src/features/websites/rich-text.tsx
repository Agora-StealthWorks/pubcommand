"use client";

import { RichTextEditor } from "@/components/rich-text-editor";
import { uploadEditorImage } from "./actions";

/** The post body: the shared WYSIWYG editor, with image uploads going into this site's media library. */
export function WebsiteRichText({ siteId, defaultValue }: { siteId: string; defaultValue: string }) {
  const upload = async (file: File) => {
    const body = new FormData();
    body.set("siteId", siteId);
    body.set("file", file);
    return uploadEditorImage(body);
  };
  return <RichTextEditor id="post-body" name="bodyHtml" defaultValue={defaultValue} onUploadImage={upload} minHeight={460} ariaLabel="Post content" placeholder="Start writing…" />;
}
