import { describe, expect, it } from "vitest";
import { embedSrc } from "@/components/rich-text-editor/embed";
import { richContentCss } from "@/components/rich-text-editor/content-css";
import { sanitizeRichText } from "@/components/rich-text-editor/sanitize";

describe("rich-text editor output", () => {
  it("keeps headings, alignment, colours, highlights and links", () => {
    const html = sanitizeRichText('<h2 style="text-align: center">Title</h2><p style="text-align: right; position: fixed">Hi <span style="color: #b42318; font-size: 90px">red</span> <mark data-color="#fef08a" style="background-color: #fef08a; color: inherit">mark</mark> <a href="https://x.test" target="_blank">x</a></p>');
    expect(html).toBe('<h2 style="text-align:center">Title</h2><p style="text-align:right">Hi <span style="color:#b42318">red</span> <mark data-color="#fef08a" style="background-color:#fef08a">mark</mark> <a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a></p>');
  });

  it("keeps image wrap and width classes only", () => {
    expect(sanitizeRichText('<img src="https://cdn.test/a.png" class="rte-img rte-img-left rte-w-50 evil" onerror="x()">')).toBe('<img src="https://cdn.test/a.png" class="rte-img rte-img-left rte-w-50" />');
    expect(sanitizeRichText('<img src="/l/launch/asset/1" class="rte-img-full">')).toBe('<img src="/l/launch/asset/1" class="rte-img-full" />');
    expect(sanitizeRichText('<img src="javascript:alert(1)">')).toBe("<img />");
  });

  it("keeps embeds from allowed players only, with fixed attributes", () => {
    const ok = sanitizeRichText('<div class="rte-embed"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" onload="x()" allow="camera"></iframe></div>');
    expect(ok).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(ok).not.toContain("onload");
    expect(ok).not.toContain("camera");
    expect(sanitizeRichText('<div class="rte-embed"><iframe src="https://evil.test/embed/x"></iframe></div>')).not.toContain("iframe");
    expect(sanitizeRichText('<div class="other" style="x"><script>alert(1)</script>t</div>')).toBe("<div>t</div>");
  });

  it("turns share links into player links", () => {
    expect(embedSrc("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedSrc("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedSrc("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedSrc("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(embedSrc("https://acme.wistia.com/medias/abc123xyz9")).toBe("https://fast.wistia.net/embed/iframe/abc123xyz9");
    expect(embedSrc("https://www.loom.com/share/0123456789abcdef0123456789abcdef")).toBe("https://www.loom.com/embed/0123456789abcdef0123456789abcdef");
    expect(embedSrc("https://evil.test/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(embedSrc("javascript:alert(1)")).toBeNull();
  });

  it("scopes the content CSS", () => {
    expect(richContentCss(".pcf-rich")).toContain(".pcf-rich img.rte-img-left{float:left");
  });
});
