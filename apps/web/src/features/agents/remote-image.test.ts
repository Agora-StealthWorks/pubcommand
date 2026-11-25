import { describe, expect, it } from "vitest";
import { fetchRemoteImage, imageTypeOf, isPrivateAddress } from "./remote-image";
import { ToolError } from "./tool-kit";

describe("images agents point to", () => {
  it("refuses private, loopback, link-local and shared addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "104.16.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  it("recognizes images by their bytes, not their names", () => {
    expect(imageTypeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), "x.jpg")).toBe("image/png");
    expect(imageTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "photo")).toBe("image/jpeg");
    expect(imageTypeOf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "logo")).toBe("image/svg+xml");
    expect(imageTypeOf(new TextEncoder().encode("<html><body>not an image</body></html>"), "photo.png")).toBeNull();
  });

  it("refuses non-https and internal addresses before fetching", async () => {
    await expect(fetchRemoteImage("http://example.com/a.png", 3)).rejects.toThrow(ToolError);
    await expect(fetchRemoteImage("https://127.0.0.1/a.png", 3)).rejects.toThrow(/private network/);
    await expect(fetchRemoteImage("https://169.254.169.254/latest/meta-data", 3)).rejects.toThrow(/private network/);
    await expect(fetchRemoteImage("not a url", 3)).rejects.toThrow(ToolError);
  });
});
