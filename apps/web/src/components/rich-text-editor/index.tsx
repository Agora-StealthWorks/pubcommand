"use client";

import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, Node, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { richContentCss } from "./content-css";
import { embedSrc } from "./embed";

export { RichContentStyles, richContentCss } from "./content-css";

export type UploadResult = { ok: true; src: string } | { ok: false; error: string };

export type RichTextEditorProps = {
  id?: string;
  /** Form field name: the HTML is kept in a hidden input, so the editor works inside a plain <form>. */
  name?: string;
  /** Controlled HTML. Use with onChange. */
  value?: string;
  /** Uncontrolled starting HTML. */
  defaultValue?: string;
  onChange?: (html: string) => void;
  /** Upload an image and return its public https (or same-site) address. Without it, images can only be added by link. */
  onUploadImage?: (file: File) => Promise<UploadResult>;
  /** Turn parts of the toolbar off. */
  features?: { images?: boolean; embeds?: boolean; colors?: boolean; headings?: boolean };
  /** {tags} offered in an "Insert tag" menu (email templates). */
  mergeTags?: readonly { tag: string; description: string }[];
  placeholder?: string;
  /** Editing area height in px (it grows with the content). */
  minHeight?: number;
  disabled?: boolean;
  ariaLabel?: string;
  hint?: ReactNode;
};

const IMAGE_ALIGNS = ["left", "center", "right", "full"] as const;
const IMAGE_SIZES = ["25", "33", "50", "75", "100"] as const;
type ImageAlign = (typeof IMAGE_ALIGNS)[number];

/** Image with wrap (float left/right, centred, full width) and a width preset, stored as classes the sanitizer allows. */
const RteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => IMAGE_ALIGNS.find((align) => element.classList.contains(`rte-img-${align}`)) ?? null,
        renderHTML: (attributes: { align?: string | null }) => (attributes.align ? { class: `rte-img rte-img-${attributes.align}` } : {}),
      },
      size: {
        default: null,
        parseHTML: (element: HTMLElement) => IMAGE_SIZES.find((size) => element.classList.contains(`rte-w-${size}`)) ?? null,
        renderHTML: (attributes: { size?: string | null }) => (attributes.size ? { class: `rte-w-${attributes.size}` } : {}),
      },
    };
  },
});

/** A video from an allow-listed player, in a 16:9 box. */
const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null } };
  },
  parseHTML() {
    return [
      { tag: "div.rte-embed", getAttrs: (element: HTMLElement) => ({ src: embedSrc(element.querySelector("iframe")?.getAttribute("src") ?? "") }) },
      {
        tag: "iframe[src]",
        getAttrs: (element: HTMLElement) => {
          const src = embedSrc(element.getAttribute("src") ?? "");
          return src ? { src } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    return ["div", { class: "rte-embed" }, ["iframe", { src: node.attrs.src as string, title: "Video", frameborder: "0", allowfullscreen: "true", allow: "autoplay; fullscreen; picture-in-picture; encrypted-media" }]];
  },
});

const SWATCHES = ["#111827", "#475467", "#b42318", "#c4320a", "#b54708", "#067647", "#1d4ed8", "#6927da", "#ffffff"];
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa"];

type Panel = null | "link" | "embed" | "image-url" | "color" | "highlight";

const SCOPE = "rte-editor";

function emptyToBlank(editor: Editor): string {
  return editor.isEmpty ? "" : editor.getHTML();
}

/**
 * A WYSIWYG rich-text editor (TipTap): headings, bold/italic/underline/strike,
 * colours and highlights, alignment, lists, quotes, links, images (upload or
 * link, with text wrap and width), video embeds and an HTML view. It writes
 * HTML for the app's sanitizer, which must run on save and on render: nothing
 * here is trusted on the server.
 */
export function RichTextEditor({
  id,
  name,
  value,
  defaultValue,
  onChange,
  onUploadImage,
  features = {},
  mergeTags,
  placeholder = "Start writing…",
  minHeight = 160,
  disabled = false,
  ariaLabel,
  hint,
}: RichTextEditorProps) {
  const autoId = useId();
  const fieldId = id ?? `rte-${autoId.replace(/:/g, "")}`;
  const { images = true, embeds = true, colors = true, headings = true } = features;
  const controlled = value !== undefined;
  const [html, setHtml] = useState(controlled ? value : defaultValue ?? "");
  const lastEmitted = useRef(html);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelValue, setPanelValue] = useState("");
  const [newTab, setNewTab] = useState(true);
  const [source, setSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer", target: null } },
        code: false,
        codeBlock: false,
        // No forced empty paragraph at the end of the stored HTML.
        trailingNode: false,
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      RteImage.configure({ inline: false, allowBase64: false }),
      Embed,
    ],
    content: html,
    editorProps: {
      attributes: {
        id: fieldId,
        class: `${SCOPE} rte-content prose-none min-w-0 px-3 py-2 text-[15px] leading-relaxed text-ink outline-none`,
        style: `min-height:${minHeight}px`,
        "aria-label": ariaLabel ?? "Rich text",
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = emptyToBlank(current);
      lastEmitted.current = next;
      setHtml(next);
      onChange?.(next);
    },
  });

  // Follow a controlled value that changed outside the editor (another block, a reset).
  useEffect(() => {
    if (!editor || !controlled || value === lastEmitted.current) return;
    lastEmitted.current = value;
    setHtml(value);
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, controlled, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            block: current.isActive("heading", { level: 2 }) ? "h2" : current.isActive("heading", { level: 3 }) ? "h3" : current.isActive("heading", { level: 4 }) ? "h4" : "p",
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            strike: current.isActive("strike"),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            quote: current.isActive("blockquote"),
            link: current.isActive("link"),
            image: current.isActive("image"),
            imageAlign: (current.getAttributes("image").align as string | null) ?? null,
            imageSize: (current.getAttributes("image").size as string | null) ?? null,
            align: (["center", "right", "justify"] as const).find((align) => current.isActive({ textAlign: align })) ?? "left",
            canUndo: current.can().undo(),
            canRedo: current.can().redo(),
          }
        : null,
  });

  const open = (next: Panel, initial = "") => {
    setPanel(panel === next ? null : next);
    setPanelValue(initial);
    setError(null);
  };

  const applyLink = () => {
    if (!editor) return;
    const href = panelValue.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
      setError("Links must start with https://, mailto: or tel:");
      return;
    } else {
      const chain = editor.chain().focus().extendMarkRange("link");
      if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href, target: newTab ? "_blank" : null } }] }).run();
      else chain.setLink({ href, target: newTab ? "_blank" : null }).run();
    }
    setPanel(null);
  };

  const applyEmbed = () => {
    const src = embedSrc(panelValue);
    if (!src) {
      setError("Paste a YouTube, Vimeo, Wistia or Loom link.");
      return;
    }
    editor?.chain().focus().insertContent({ type: "embed", attrs: { src } }).run();
    setPanel(null);
  };

  const applyImageUrl = () => {
    const src = panelValue.trim();
    if (!/^https:\/\/[^\s"<>]+$/i.test(src)) {
      setError("Image links must start with https://");
      return;
    }
    editor?.chain().focus().setImage({ src, alt: "" }).run();
    setPanel(null);
  };

  const upload = async (chosen: File | undefined) => {
    if (!chosen || !onUploadImage || !editor) return;
    setBusy(true);
    setError(null);
    const result = await onUploadImage(chosen);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else editor.chain().focus().setImage({ src: result.src, alt: "" }).run();
  };

  const setBlock = (block: string) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (block === "p") chain.setParagraph().run();
    else chain.setHeading({ level: Number(block.slice(1)) as 2 | 3 | 4 }).run();
  };

  const toggleSource = () => {
    if (!editor) return;
    if (source) {
      editor.commands.setContent(html || "", { emitUpdate: true });
    } else {
      setHtml(emptyToBlank(editor));
    }
    setSource(!source);
    setPanel(null);
  };

  const onSourceChange = (next: string) => {
    lastEmitted.current = next;
    setHtml(next);
    onChange?.(next);
  };

  const tool = "inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded border px-2 text-xs font-semibold disabled:opacity-40";
  const btn = (active: boolean | undefined) => `${tool} ${active ? "border-accent bg-[#eef2ff] text-[#1e3a8a]" : "border-line bg-white text-ink hover:bg-canvas"}`;
  const off = disabled || source || !editor;
  const B = ({ label, title, active, onClick, disabled: d }: { label: ReactNode; title: string; active?: boolean; onClick: () => void; disabled?: boolean }) => (
    <button type="button" className={btn(active)} title={title} aria-label={title} aria-pressed={active ?? undefined} disabled={off || d} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {label}
    </button>
  );
  const Sep = () => <span className="mx-0.5 hidden h-6 w-px self-center bg-line sm:block" aria-hidden="true" />;

  return (
    <div className="min-w-0">
      <style dangerouslySetInnerHTML={{ __html: `${richContentCss(`.${SCOPE}`)}\n.${SCOPE} p{margin:.5rem 0}.${SCOPE} h2{font-size:1.35rem;font-weight:700;margin:.9rem 0 .4rem}.${SCOPE} h3{font-size:1.15rem;font-weight:700;margin:.8rem 0 .35rem}.${SCOPE} h4{font-size:1rem;font-weight:700;margin:.7rem 0 .3rem}.${SCOPE} ul{list-style:disc;padding-left:1.4rem}.${SCOPE} ol{list-style:decimal;padding-left:1.4rem}.${SCOPE} a{color:#1d4ed8;text-decoration:underline}.${SCOPE} img.ProseMirror-selectednode,.${SCOPE} .rte-embed.ProseMirror-selectednode{outline:3px solid #1d4ed8}.${SCOPE} p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#98a2b3;float:left;height:0;pointer-events:none}.${SCOPE} .rte-embed iframe{pointer-events:none}` }} />
      <div className={`overflow-hidden rounded-md border border-line bg-white ${disabled ? "opacity-70" : ""}`}>
        <div className="flex flex-wrap items-center gap-1 border-b border-line bg-canvas/60 p-1.5" role="toolbar" aria-label="Formatting">
          {headings ? (
            <select aria-label="Text style" className="pc-control h-9 min-h-9 w-[118px] py-0 text-xs" value={state?.block ?? "p"} disabled={off} onChange={(event) => setBlock(event.target.value)}>
              <option value="p">Paragraph</option>
              <option value="h2">Heading</option>
              <option value="h3">Subheading</option>
              <option value="h4">Small heading</option>
            </select>
          ) : null}
          <B label={<b>B</b>} title="Bold" active={state?.bold} onClick={() => editor?.chain().focus().toggleBold().run()} />
          <B label={<i>I</i>} title="Italic" active={state?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()} />
          <B label={<u>U</u>} title="Underline" active={state?.underline} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
          <B label={<s>S</s>} title="Strikethrough" active={state?.strike} onClick={() => editor?.chain().focus().toggleStrike().run()} />
          {colors ? (
            <>
              <B label={<span className="border-b-2 border-[#b42318] leading-none">A</span>} title="Text colour" active={panel === "color"} onClick={() => open("color")} />
              <B label={<span className="rounded-sm bg-[#fef08a] px-1 leading-none">H</span>} title="Highlight" active={panel === "highlight"} onClick={() => open("highlight")} />
            </>
          ) : null}
          <Sep />
          <B label="⯇≡" title="Align left" active={state?.align === "left"} onClick={() => editor?.chain().focus().setTextAlign("left").run()} />
          <B label="≡" title="Align centre" active={state?.align === "center"} onClick={() => editor?.chain().focus().setTextAlign("center").run()} />
          <B label="≡⯈" title="Align right" active={state?.align === "right"} onClick={() => editor?.chain().focus().setTextAlign("right").run()} />
          <Sep />
          <B label="• List" title="Bulleted list" active={state?.bullet} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
          <B label="1. List" title="Numbered list" active={state?.ordered} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
          <B label="❝" title="Quote" active={state?.quote} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
          <B label="―" title="Divider line" onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
          <Sep />
          <B label="Link" title="Link" active={state?.link || panel === "link"} onClick={() => open("link", (editor?.getAttributes("link").href as string | undefined) ?? "")} />
          {images ? (
            <>
              {onUploadImage ? <B label={busy ? "Uploading…" : "Image"} title="Upload an image" disabled={busy} onClick={() => file.current?.click()} /> : null}
              <B label={onUploadImage ? "Image link" : "Image"} title="Image from a link" active={panel === "image-url"} onClick={() => open("image-url")} />
            </>
          ) : null}
          {embeds ? <B label="▶ Video" title="Embed a video" active={panel === "embed"} onClick={() => open("embed")} /> : null}
          {mergeTags?.length ? (
            <select
              aria-label="Insert a merge tag"
              className="pc-control h-9 min-h-9 w-[120px] py-0 text-xs"
              value=""
              disabled={off}
              onChange={(event) => {
                if (event.target.value) editor?.chain().focus().insertContent(`{${event.target.value}}`).run();
              }}
            >
              <option value="">Insert tag…</option>
              {mergeTags.map((item) => (
                <option key={item.tag} value={item.tag} title={item.description}>
                  {`{${item.tag}}`}
                </option>
              ))}
            </select>
          ) : null}
          <Sep />
          <B label="↶" title="Undo" disabled={!state?.canUndo} onClick={() => editor?.chain().focus().undo().run()} />
          <B label="↷" title="Redo" disabled={!state?.canRedo} onClick={() => editor?.chain().focus().redo().run()} />
          <button type="button" className={btn(source)} aria-pressed={source} title="Edit the HTML" disabled={disabled || !editor} onClick={toggleSource}>
            HTML
          </button>
          {images && onUploadImage ? (
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                void upload(chosen);
              }}
            />
          ) : null}
        </div>

        {state?.image && !source ? (
          <div className="flex flex-wrap items-center gap-1 border-b border-line bg-[#f8f9fc] px-1.5 py-1 text-xs" role="toolbar" aria-label="Image">
            <span className="px-1 font-semibold text-muted">Image:</span>
            {IMAGE_ALIGNS.map((align: ImageAlign) => (
              <B key={align} label={{ left: "Wrap left", center: "Centre", right: "Wrap right", full: "Full width" }[align]} title={`Image: ${align}`} active={state.imageAlign === align} onClick={() => editor?.chain().focus().updateAttributes("image", { align: state.imageAlign === align ? null : align }).run()} />
            ))}
            <select aria-label="Image width" className="pc-control h-9 min-h-9 w-[92px] py-0 text-xs" value={state.imageSize ?? ""} onChange={(event) => editor?.chain().focus().updateAttributes("image", { size: event.target.value || null }).run()}>
              <option value="">Auto</option>
              {IMAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}%
                </option>
              ))}
            </select>
            <B
              label="Alt text"
              title="Describe the image"
              onClick={() => {
                const alt = window.prompt("Describe the image for screen readers", (editor?.getAttributes("image").alt as string | undefined) ?? "");
                if (alt !== null) editor?.chain().focus().updateAttributes("image", { alt: alt.slice(0, 200) }).run();
              }}
            />
          </div>
        ) : null}

        {panel ? (
          <div className="border-b border-line bg-[#f8f9fc] p-2">
            {panel === "color" || panel === "highlight" ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {(panel === "color" ? SWATCHES : HIGHLIGHTS).map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`${panel === "color" ? "Colour" : "Highlight"} ${swatch}`}
                    className="h-8 w-8 rounded border border-line"
                    style={{ background: swatch }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (panel === "color") editor?.chain().focus().setColor(swatch).run();
                      else editor?.chain().focus().setHighlight({ color: swatch }).run();
                      setPanel(null);
                    }}
                  />
                ))}
                <label className="flex items-center gap-1 text-xs text-muted">
                  Custom
                  <input
                    type="color"
                    className="h-8 w-10 cursor-pointer rounded border border-line bg-white p-0.5"
                    onChange={(event) => {
                      if (panel === "color") editor?.chain().focus().setColor(event.target.value).run();
                      else editor?.chain().focus().setHighlight({ color: event.target.value }).run();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className={btn(false)}
                  onClick={() => {
                    if (panel === "color") editor?.chain().focus().unsetColor().run();
                    else editor?.chain().focus().unsetHighlight().run();
                    setPanel(null);
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  aria-label={panel === "link" ? "Link address" : panel === "embed" ? "Video link" : "Image link"}
                  className="pc-control h-9 min-h-9 min-w-0 flex-1 basis-56 text-sm"
                  placeholder={panel === "link" ? "https://… (empty removes the link)" : panel === "embed" ? "YouTube, Vimeo, Wistia or Loom link" : "https://…/image.jpg"}
                  value={panelValue}
                  onChange={(event) => setPanelValue(event.target.value)}
                  onKeyDown={(event) => {
                    // The editor sits inside the page's own <form>: Enter applies here instead of submitting it.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (panel === "link") applyLink();
                      else if (panel === "embed") applyEmbed();
                      else applyImageUrl();
                    }
                  }}
                />
                {panel === "link" ? (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" className="h-4 w-4 accent-accent" checked={newTab} onChange={(event) => setNewTab(event.target.checked)} /> New tab
                  </label>
                ) : null}
                <button type="button" className={btn(true)} onClick={() => (panel === "link" ? applyLink() : panel === "embed" ? applyEmbed() : applyImageUrl())}>
                  {panel === "link" ? "Apply" : "Insert"}
                </button>
                <button type="button" className={btn(false)} onClick={() => setPanel(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        ) : null}

        {source ? (
          <textarea
            aria-label="HTML"
            className="block w-full min-w-0 border-0 px-3 py-2 font-mono text-[13px] leading-relaxed text-ink outline-none"
            style={{ minHeight }}
            value={html}
            onChange={(event) => onSourceChange(event.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className="relative">
            {editor ? null : <div className="px-3 py-2 text-sm text-muted" style={{ minHeight }}>Loading the editor…</div>}
            <EditorContent editor={editor} />
            {editor && editor.isEmpty && !disabled ? <span className="pointer-events-none absolute left-3 top-2 text-[15px] text-[#98a2b3]">{placeholder}</span> : null}
          </div>
        )}
      </div>
      {name ? <input type="hidden" name={name} value={html} /> : null}
      {error ? (
        <p className="mt-1 text-xs text-[#912018]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
