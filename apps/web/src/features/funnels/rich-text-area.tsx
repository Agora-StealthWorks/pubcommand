"use client";

import { RichTextEditor } from "@/components/rich-text-editor";
import { uploadFunnelImage } from "./site-actions";

/**
 * The Funnels rich-text field: the shared WYSIWYG editor with image uploads
 * stored on this funnel. It writes HTML; the server sanitizes it on save and
 * again on render. Works controlled (value/onChange) or inside a plain form
 * (name/defaultValue).
 */
export function RichTextArea({
  funnelId,
  id,
  name,
  value,
  defaultValue,
  onChange,
  rows = 6,
  images = true,
  embeds = true,
  mergeTags,
  disabled,
}: {
  funnelId: string;
  id: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  rows?: number;
  images?: boolean;
  embeds?: boolean;
  mergeTags?: readonly { tag: string; description: string }[];
  disabled?: boolean;
}) {
  const upload = async (file: File) => {
    const body = new FormData();
    body.set("funnelId", funnelId);
    body.set("kind", "block");
    body.set("file", file);
    const result = await uploadFunnelImage(body);
    return result.ok ? { ok: true as const, src: result.src } : { ok: false as const, error: result.error };
  };
  return (
    <RichTextEditor
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      onUploadImage={images ? upload : undefined}
      features={{ images, embeds }}
      mergeTags={mergeTags}
      minHeight={Math.max(72, rows * 24)}
      disabled={disabled}
    />
  );
}
