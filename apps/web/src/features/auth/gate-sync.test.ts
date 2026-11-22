import { openGate, sealGate } from "@pubcommand/auth/edge";
import { describe, expect, it } from "vitest";
import { openGateSync } from "@/lib/gate-sync";

describe("openGateSync", () => {
  const secret = "a-long-test-secret-for-the-gate";
  const payload = { sid: "s1", uid: "u1", role: "SUPER_ADMIN" as const, mfa: true };

  it("opens exactly what openGate opens", async () => {
    const token = await sealGate(payload, secret);
    expect(openGateSync(token, secret)).toEqual(await openGate(token, secret));
    expect(openGateSync(token, secret)).toMatchObject(payload);
  });

  it("refuses a wrong secret, a tampered body and an expired gate", async () => {
    const token = await sealGate(payload, secret);
    expect(openGateSync(token, "another-secret-entirely")).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, role: "OPS", exp: Date.now() + 1e6 })).toString("base64url");
    expect(openGateSync(`${forged}.${sig}`, secret)).toBeNull();
    expect(openGateSync(`${body}`, secret)).toBeNull();
    expect(openGateSync(token, secret, Date.now() + 1000 * 60 * 60 * 13)).toBeNull();
  });
});
