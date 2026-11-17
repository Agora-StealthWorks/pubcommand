import { describe, expect, it } from "vitest";
import { FetchRefused, guardedLookup, safeFetch } from "./fetch";

describe("safeFetch SSRF guard", () => {
  it.each(["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://localhost/", "file:///etc/passwd", "http://10.0.0.1:8080/"])(
    "refuses %s before connecting",
    async (url) => {
      await expect(safeFetch(url)).rejects.toBeInstanceOf(FetchRefused);
    },
  );
});

describe("guarded DNS lookup", () => {
  it("refuses a name that resolves to a private address", async () => {
    const result = await new Promise<{ code?: string }>((resolve) => guardedLookup("localhost", {}, (error) => resolve({ code: (error as { code?: string } | null)?.code })));
    expect(result.code).toBe("EPRIVATE");
  });

  it("refuses with the all-addresses form too", async () => {
    const result = await new Promise<{ code?: string }>((resolve) => guardedLookup("localhost", { all: true }, (error) => resolve({ code: (error as { code?: string } | null)?.code })));
    expect(result.code).toBe("EPRIVATE");
  });
});

describe("fallback readers stay behind the SSRF guard", () => {
  it.each(["http://127.0.0.1/a", "http://169.254.169.254/latest/", "http://[fd00::1]/", "http://192.168.1.5/x"])("never hands %s to a reader or archive", async (url) => {
    const { assertPublicTarget, ingestUrl } = await import("./ingest");
    const before = process.env.RESEARCH_FALLBACK_READERS;
    process.env.RESEARCH_FALLBACK_READERS = "all";
    try {
      await expect(assertPublicTarget(url)).rejects.toBeInstanceOf(FetchRefused);
      const outcome = await ingestUrl(url, "");
      expect(outcome).toMatchObject({ error: expect.stringMatching(/private network|not allowed/) });
    } finally {
      if (before === undefined) delete process.env.RESEARCH_FALLBACK_READERS;
      else process.env.RESEARCH_FALLBACK_READERS = before;
    }
  });

  it("refuses an X link pointing anywhere but X", async () => {
    const { ingestX } = await import("./ingest");
    expect(await ingestX("https://example.com/a/status/123", "", "")).toMatchObject({ error: expect.stringContaining("not a link to an X post") });
    expect(await ingestX("https://x.com/ann/status/1234567", "", "Pasted thread text that is long enough.")).toMatchObject({ kind: "x", sourceRef: "https://x.com/ann/status/1234567" });
  });
});
