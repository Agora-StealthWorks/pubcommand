import { Prisma } from "@pubcommand/db";
import { describe, expect, it } from "vitest";
import { SENSITIVE_FIELD, checkWhere, readableFields } from "./platform-audit-tools";
import { ToolError } from "./tool-kit";

type Model = Parameters<typeof readableFields>[0];
const model = (name: string) => (Prisma.dmmf.datamodel.models as unknown as Model[]).find((m) => m.name === name)!;

describe("platform agents' record reader", () => {
  it("never exposes secrets", () => {
    const user = readableFields(model("User")).map((f) => f.name);
    expect(user).toContain("email");
    expect(user).not.toContain("passwordHash");
    expect(readableFields(model("PlatformStaff")).map((f) => f.name)).not.toContain("totpSecretCipher");
    expect(readableFields(model("AiAgentToken")).map((f) => f.name)).not.toContain("tokenHash");
    expect(readableFields(model("FunnelDay")).map((f) => f.name)).not.toContain("unlockKey");
    expect(readableFields(model("FormFile")).map((f) => f.name)).not.toContain("data");
    for (const name of ["passwordHash", "tokenHash", "keyHash", "codeHash", "totpSecretCipher", "unlockKey", "apiKeyHash", "token"]) expect(SENSITIVE_FIELD.test(name)).toBe(true);
    for (const name of ["email", "title", "status", "organizationId", "createdAt"]) expect(SENSITIVE_FIELD.test(name)).toBe(false);
  });

  it("accepts ordinary filters, through relations too", () => {
    expect(() => checkWhere(model("Form"), { status: "OPEN", title: { contains: "gold", mode: "insensitive" } })).not.toThrow();
    expect(() => checkWhere(model("Membership"), { user: { email: { endsWith: "@example.com" } }, OR: [{ status: "ACTIVE" }, { status: "INVITED" }] })).not.toThrow();
    expect(() => checkWhere(model("User"), { memberships: { some: { status: "ACTIVE" } } })).not.toThrow();
  });

  it("refuses filters that could probe secrets, unknown fields and unknown operators", () => {
    expect(() => checkWhere(model("User"), { passwordHash: { startsWith: "$2" } })).toThrow(ToolError);
    expect(() => checkWhere(model("Membership"), { user: { passwordHash: null } })).toThrow(ToolError);
    expect(() => checkWhere(model("User"), { AND: [{ email: "a" }, { passwordHash: "x" }] })).toThrow(ToolError);
    expect(() => checkWhere(model("User"), { sessions: { some: { expiresAt: { gt: new Date() } } } })).toThrow(ToolError);
    expect(() => checkWhere(model("Form"), { nope: 1 })).toThrow(ToolError);
    expect(() => checkWhere(model("Form"), { title: { $where: "1" } })).toThrow(ToolError);
  });
});
