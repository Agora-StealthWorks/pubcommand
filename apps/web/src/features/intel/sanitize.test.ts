import { describe, expect, it } from "vitest";
import { emailDocument, sanitizeEmailHtml } from "./sanitize";

const EMAIL = `
<html><head><title>x</title><style>@import url("https://evil.example/a.css"); .h{background:url(https://track.example/bg.png)}</style></head>
<body onload="alert(1)">
<script>alert(1)</script>
<table background="https://track.example/t.png" style="width:600px;background-image:url('//track.example/s.png')"><tr><td>
<img src="https://track.example/pixel.gif" width="1" height="1" srcset="https://x.example/2x.png 2x">
<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo">
<img src="data:text/html;base64,PHNjcmlwdD4=">
<a href="javascript:alert(1)">bad</a>
<a href="https://offer.example/p" onclick="steal()">Order now</a>
<form action="https://phish.example"><input name="card"></form>
<iframe src="https://evil.example"></iframe>
<p style="color:red;width:expression(alert(1))">Hello</p>
</td></tr></table></body></html>`;

describe("email sanitizer", () => {
  it("strips scripts, handlers, forms, frames and bad schemes", () => {
    const { html } = sanitizeEmailHtml(EMAIL, { allowRemoteImages: false });
    expect(html).not.toMatch(/<script|onload|onclick|alert\(1\)<|<form|<input|<iframe|javascript:|expression\(/i);
    expect(html).toContain("Order now");
    expect(html).toContain('href="https://offer.example/p"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain("color:red");
    expect(html).not.toContain("data:text/html");
  });

  it("blocks remote images, CSS urls, backgrounds and imports by default", () => {
    const { html, blockedImages } = sanitizeEmailHtml(EMAIL, { allowRemoteImages: false });
    expect(html).not.toMatch(/track\.example|evil\.example\/a\.css|srcset/);
    expect(html).toContain('data-intel-blocked="1"');
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(blockedImages).toBe(5);
  });

  it("keeps remote images when the viewer turns them on", () => {
    const { html, blockedImages } = sanitizeEmailHtml(EMAIL, { allowRemoteImages: true });
    expect(html).toContain('src="https://track.example/pixel.gif"');
    expect(html).toContain('background="https://track.example/t.png"');
    expect(html).not.toContain("srcset");
    expect(blockedImages).toBe(0);
  });

  it("wraps the result in a document whose CSP matches the image setting", () => {
    expect(emailDocument("<p>x</p>", { allowRemoteImages: false })).toContain("img-src data:;");
    expect(emailDocument("<p>x</p>", { allowRemoteImages: true })).toContain("img-src data: https:;");
    expect(emailDocument("<p>x</p>", { allowRemoteImages: false })).toContain("default-src 'none'");
  });
});
