import { describe, expect, it } from "vitest";
import { embedUrl, fallbackThumbnail, formatDuration, oembedUrl, parseDuration, parseVideo, readOembed, vidalyticsParts, vidalyticsScriptBase, watchUrl } from "./video";

describe("Wistia", () => {
  it("reads media links, iframe links, share links and bare ids", () => {
    expect(parseVideo("https://acme.wistia.com/medias/abc123defg")).toEqual({ provider: "wistia", id: "abc123defg" });
    expect(parseVideo("https://fast.wistia.net/embed/iframe/ABC123DEFG?videoFoam=true")).toEqual({ provider: "wistia", id: "abc123defg" });
    expect(parseVideo("https://acme.com/page?wvideo=abc123defg")).toBeNull();
    expect(parseVideo("https://acme.wistia.com/projects/x?wvideo=abc123defg")).toEqual({ provider: "wistia", id: "abc123defg" });
    expect(parseVideo("abc123defg")).toEqual({ provider: "wistia", id: "abc123defg" });
    expect(parseVideo("ab12cd", "wistia")).toEqual({ provider: "wistia", id: "ab12cd" });
  });

  it("reads embed snippets", () => {
    const snippet = `<script src="https://fast.wistia.com/embed/medias/abc123defg.jsonp" async></script><div class="wistia_embed wistia_async_abc123defg videoFoam=true">&nbsp;</div>`;
    expect(parseVideo(snippet)).toEqual({ provider: "wistia", id: "abc123defg" });
    expect(parseVideo(`<iframe src="https://fast.wistia.net/embed/iframe/abc123defg" allowfullscreen></iframe>`)).toEqual({ provider: "wistia", id: "abc123defg" });
  });

  it("builds embed, watch and oEmbed addresses, thumbnails at nav size", () => {
    const ref = { provider: "wistia" as const, id: "abc123defg" };
    expect(embedUrl(ref)).toBe("https://fast.wistia.net/embed/iframe/abc123defg?videoFoam=true");
    expect(parseVideo(watchUrl(ref))).toEqual(ref);
    expect(oembedUrl(ref)).toContain("fast.wistia.com/oembed");
    expect(readOembed({ title: "Day 1", duration: 61.4, thumbnail_url: "https://embed-ssl.wistia.com/deliveries/x.jpg?image_crop_resized=200x120" }, "wistia")).toEqual({
      title: "Day 1",
      durationSeconds: 61,
      thumbnailUrl: "https://embed-ssl.wistia.com/deliveries/x.jpg?image_crop_resized=640x360",
    });
  });
});

describe("YouTube", () => {
  it("reads watch, short, embed, shorts and live links", () => {
    const id = "dQw4w9WgXcQ";
    for (const link of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?feature=share&v=${id}`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?t=10`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}?si=abc`,
    ]) {
      expect(parseVideo(link)).toEqual({ provider: "youtube", id });
    }
    expect(parseVideo(`<iframe width="560" src="https://www.youtube.com/embed/${id}" frameborder="0"></iframe>`)).toEqual({ provider: "youtube", id });
    expect(parseVideo(id)).toEqual({ provider: "youtube", id });
  });

  it("has a thumbnail without a lookup", () => {
    expect(fallbackThumbnail({ provider: "youtube", id: "dQw4w9WgXcQ" })).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(embedUrl({ provider: "youtube", id: "dQw4w9WgXcQ" })).toContain("enablejsapi=1");
  });
});

describe("Vidalytics", () => {
  const snippet = `<div id="vidalytics_embed_Mb2kSL6l9gDDqjEG" style="width: 100%; position:relative; padding-top: 56.25%;"></div>
<script type="text/javascript">
(function (v, i, d, a, l) { /* loader */ })(window, document, 'Vidalytics', 'vidalytics_embed_Mb2kSL6l9gDDqjEG', 'https://fast.vidalytics.com/embeds/xH8dAqJk/Mb2kSL6l9gDDqjEG/');
</script>`;

  it("reads the embed snippet, the embed address and account/embed ids", () => {
    const ref = { provider: "vidalytics", id: "xH8dAqJk/Mb2kSL6l9gDDqjEG" };
    expect(parseVideo(snippet)).toEqual(ref);
    expect(parseVideo("https://fast.vidalytics.com/embeds/xH8dAqJk/Mb2kSL6l9gDDqjEG/")).toEqual(ref);
    expect(parseVideo("xH8dAqJk/Mb2kSL6l9gDDqjEG", "vidalytics")).toEqual(ref);
    expect(parseVideo("xH8dAqJk/Mb2kSL6l9gDDqjEG")).toEqual(ref);
    expect(vidalyticsParts(ref as never)).toEqual({ account: "xH8dAqJk", embed: "Mb2kSL6l9gDDqjEG" });
    expect(vidalyticsScriptBase(ref as never)).toBe("https://fast.vidalytics.com/embeds/xH8dAqJk/Mb2kSL6l9gDDqjEG/");
    expect(parseVideo(watchUrl(ref as never))).toEqual(ref);
    expect(oembedUrl(ref as never)).toBeNull();
    expect(fallbackThumbnail(ref as never)).toBeNull();
  });
});

describe("provider override and hostile input", () => {
  it("the admin's provider choice rejects other providers' links", () => {
    expect(parseVideo("https://youtu.be/dQw4w9WgXcQ", "wistia")).toBeNull();
    expect(parseVideo("abc123defg", "youtube")).toBeNull();
    expect(parseVideo("https://fast.wistia.net/embed/iframe/abc123defg", "vidalytics")).toBeNull();
  });

  it("refuses look-alike hosts, other schemes and injected characters", () => {
    for (const bad of [
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://evilwistia.com/medias/abc123defg",
      "https://fast.vidalytics.com.evil.example/embeds/xH8dAqJk/Mb2kSL6l9gDDqjEG/",
      "javascript:alert(1)//youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXc\"><script>",
      "https://fast.vidalytics.com/embeds/xH8d\"Aq/Mb2kSL6l9gDDqjEG/",
      "ab/cd",
      "../../etc/passwd",
      "a".repeat(200),
      "<img src=x onerror=alert(1)>",
      "xH8dAqJk/Mb2kSL6l9gDDqjEG/extra",
    ]) {
      expect(parseVideo(bad), bad).toBeNull();
    }
    expect(parseVideo("")).toBeNull();
    expect(parseVideo(null)).toBeNull();
    expect(parseVideo("   ")).toBeNull();
  });
});

describe("durations", () => {
  it("parses and formats", () => {
    expect(parseDuration("12:34")).toBe(754);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1:99")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
    expect(formatDuration(754)).toBe("12:34");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(null)).toBe("");
  });
});
