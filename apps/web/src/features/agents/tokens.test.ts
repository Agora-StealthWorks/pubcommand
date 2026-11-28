import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bearerToken, generateToken, hashToken, isAllowedRedirectUri, pkceMatches, tokenKind } from "./tokens";

describe("agent tokens", () => {
  it("are recognised by kind and stored only as a hash", () => {
    for (const kind of ["key", "access", "refresh"] as const) {
      const made = generateToken(kind);
      expect(tokenKind(made.token)).toBe(kind);
      expect(made.hash).toBe(hashToken(made.token));
      expect(made.hash).not.toContain(made.token);
      expect(made.token.startsWith(made.prefix)).toBe(true);
    }
    expect(tokenKind("pcc_" + "a".repeat(43))).toBeNull();
    expect(tokenKind("pca_short")).toBeNull();
  });

  it("reads a bearer header", () => {
    expect(bearerToken(new Headers({ authorization: "Bearer abc" }))).toBe("abc");
    expect(bearerToken(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(bearerToken(new Headers({ authorization: "pca_abc" }))).toBe("pca_abc");
    expect(bearerToken(new Headers({ authorization: "pcat_abc" }))).toBeNull();
    expect(bearerToken(new Headers())).toBeNull();
  });
});

describe("PKCE", () => {
  it("accepts the S256 verifier and rejects others", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches(verifier.replace("d", "e"), challenge)).toBe(false);
    expect(pkceMatches("short", challenge)).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allow https, loopback http and known editor app links only", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:6274/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://evil.example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://x.example.com/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    // Cursor and other editors sign in through their own app link.
    expect(isAllowedRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:8787/callback")).toBe(true);
    expect(isAllowedRedirectUri("vscode://vscode.github-authentication/did-authenticate")).toBe(true);
    expect(isAllowedRedirectUri("data:text/html,hi")).toBe(false);
    expect(isAllowedRedirectUri("myapp://callback")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });
});
