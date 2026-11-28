import { describe, expect, it } from "vitest";
import { cursorInstallLink, cursorMcpJson } from "./cursor";

describe("Cursor", () => {
  it("builds the install link with a base64 config holding only the address", () => {
    const link = new URL(cursorInstallLink("pubcommand-acme", "https://acme.pubcommand.com/api/mcp"));
    expect(link.protocol).toBe("cursor:");
    expect(link.host).toBe("anysphere.cursor-deeplink");
    expect(link.pathname).toBe("/mcp/install");
    expect(link.searchParams.get("name")).toBe("pubcommand-acme");
    expect(JSON.parse(Buffer.from(link.searchParams.get("config")!, "base64").toString("utf8"))).toEqual({ url: "https://acme.pubcommand.com/api/mcp" });
  });

  it("writes mcp.json with or without a key", () => {
    expect(JSON.parse(cursorMcpJson("pubcommand", "https://a/api/mcp"))).toEqual({ mcpServers: { pubcommand: { url: "https://a/api/mcp" } } });
    expect(JSON.parse(cursorMcpJson("pubcommand", "https://a/api/mcp", "pca_x"))).toEqual({ mcpServers: { pubcommand: { url: "https://a/api/mcp", headers: { Authorization: "Bearer pca_x" } } } });
  });
});
