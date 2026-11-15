import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ensureSuperadmin } from "./superadmin";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

const HASH_A = "$2b$12$cDNQQZkReczV5Ho7D8ZdqufpYeSApFWf18fomR1TWAHGMq9iHzpZ.";
const HASH_B = "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW";

describe("ensureSuperadmin password hash", () => {
  const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const email = `superadmin-hash-${randomBytes(4).toString("hex")}@example.com`;
  const previous = process.env.SUPERADMIN_PASSWORD_HASH;

  afterAll(async () => {
    if (previous === undefined) delete process.env.SUPERADMIN_PASSWORD_HASH;
    else process.env.SUPERADMIN_PASSWORD_HASH = previous;
    await admin.user.deleteMany({ where: { email } });
    await admin.$disconnect();
  });

  it("writes SUPERADMIN_PASSWORD_HASH on every start and leaves staff TOTP alone", async () => {
    process.env.SUPERADMIN_PASSWORD_HASH = HASH_A;
    const created = await ensureSuperadmin(email);
    expect(created.createdStaff).toBe(true);
    const enrolled = await admin.platformStaff.update({
      where: { userId: created.userId },
      data: { totpSecretCipher: "cipher", totpConfirmedAt: new Date("2026-01-02T00:00:00.000Z") },
    });

    process.env.SUPERADMIN_PASSWORD_HASH = HASH_B;
    const rewritten = await ensureSuperadmin(email);
    expect(rewritten.createdStaff).toBe(false);
    const updated = await admin.user.findUniqueOrThrow({
      where: { id: created.userId },
      include: { staff: true },
    });
    expect(updated.passwordHash).toBe(HASH_B);
    expect(updated.staff?.totpSecretCipher).toBe("cipher");
    expect(updated.staff?.totpConfirmedAt?.toISOString()).toBe(enrolled.totpConfirmedAt?.toISOString());

    await ensureSuperadmin(email);
    const again = await admin.user.findUniqueOrThrow({
      where: { id: created.userId },
      include: { staff: true },
    });
    expect(again.passwordHash).toBe(HASH_B);
    expect(again.staff?.totpSecretCipher).toBe("cipher");
    expect(again.staff?.totpConfirmedAt?.toISOString()).toBe(enrolled.totpConfirmedAt?.toISOString());

    delete process.env.SUPERADMIN_PASSWORD_HASH;
    await ensureSuperadmin(email);
    const kept = await admin.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(kept.passwordHash).toBe(HASH_B);
  });
});
