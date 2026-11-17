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
