import { describe, expect, it } from "vitest";
import { richFromInput, richToInput, sanitizeRich } from "./sanitize";

describe("funnels rich text", () => {
  it("strips script, handlers and javascript links", () => {
    const html = sanitizeRich('<p onclick="x()">Hi<script>alert(1)</script> <a href="javascript:alert(1)">x</a> <img src="http://insecure/i.png"></p>');
    expect(html).not.toMatch(/script|onclick|javascript|insecure/);
    expect(html).toContain("<p>Hi");
  });

  it("turns typed text into paragraphs and back", () => {
    const typed = "First line\r\nsecond line\r\n\r\nSee https://example.com/a?b=1&c=2 <now>";
    const html = richFromInput(typed);
    expect(html).toBe('<p>First line<br />second line</p><p>See <a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">https://example.com/a?b=1&amp;c=2</a> &lt;now&gt;</p>');
    expect(richToInput(html)).toBe(typed.replace(/\r\n/g, "\n"));
    expect(richToInput("<p>Hi <b>there</b></p>")).toBe("<p>Hi <b>there</b></p>");
  });
});
