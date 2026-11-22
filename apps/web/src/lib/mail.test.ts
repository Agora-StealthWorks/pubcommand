import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deliverMagicLink, emailFrom, exposeMagicLinkOnPage } from "./mail.ts";

describe("magic link delivery", () => {
  it("logs the link when Resend is not configured", async () => {
    const lines: string[] = [];
    const result = await deliverMagicLink({
      to: "stephen@onenationfinancial.com",
      url: "https://admin.pubcommand.com/api/auth/magic-link/verify?token=abc",
      kind: "login",
      env: { NODE_ENV: "production" },
      log: (line) => lines.push(line),
    });
    assert.equal(result, "logged");
    assert.deepEqual(lines, ["[magic-link] https://admin.pubcommand.com/api/auth/magic-link/verify?token=abc"]);
  });

  it("sends through Resend and does not log the link", async () => {
    const lines: string[] = [];
    let body = "";
    const result = await deliverMagicLink({
      to: "stephen@onenationfinancial.com",
      url: "https://admin.pubcommand.com/api/auth/magic-link/verify?token=abc",
      kind: "invite",
      env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "  login@pubcommand.com  " },
      log: (line) => lines.push(line),
      fetchImpl: async (_url, init) => {
        body = init.body;
        assert.equal(init.headers.Authorization, "Bearer re_test");
        return { ok: true, status: 200, text: async () => "" };
      },
    });
    assert.equal(result, "sent");
    assert.deepEqual(lines, []);
    const payload = JSON.parse(body) as { from: string; to: string[]; text: string; html: string };
    assert.equal(payload.from, "login@pubcommand.com");
    assert.deepEqual(payload.to, ["stephen@onenationfinancial.com"]);
    assert.match(payload.text, /token=abc/);
    // Invites use the PubCommand email template (logo + button), not bare text.
    assert.match(payload.html, /brand\/logo-light\.png/);
    assert.match(payload.html, /Accept invite/);
  });

  it("never treats the dev expose flag as on in production", () => {
    assert.equal(exposeMagicLinkOnPage({ NODE_ENV: "production", AUTH_DEV_EXPOSE_LINKS: "true" }), false);
    assert.equal(exposeMagicLinkOnPage({ NODE_ENV: "development", AUTH_DEV_EXPOSE_LINKS: "true" }), true);
    assert.equal(emailFrom({}), "login@pubcommand.com");
  });
});
