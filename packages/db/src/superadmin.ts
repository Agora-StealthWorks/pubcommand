import { DEFAULT_SUPERADMIN_EMAIL, normalizeEmail } from "./email";
import { rawPrisma } from "./client";

function configuredPasswordHash() {
  const value = process.env.SUPERADMIN_PASSWORD_HASH?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export async function ensureSuperadmin(email = process.env.SUPERADMIN_EMAIL || DEFAULT_SUPERADMIN_EMAIL) {
  const normalized = normalizeEmail(email);
  const passwordHash = configuredPasswordHash();
  const existing = await rawPrisma().user.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" } },
  });
  const user = existing
    ? passwordHash
      ? await rawPrisma().user.update({
          where: { id: existing.id },
          data: { passwordHash },
        })
      : existing
    : await rawPrisma().user.create({
        data: {
          email: normalized,
          name: "Stephen Prior",
          passwordHash,
        },
      });
  const staff = await rawPrisma().platformStaff.findUnique({ where: { userId: user.id } });
  if (!staff) {
    await rawPrisma().platformStaff.create({
      data: { userId: user.id, role: "SUPER_ADMIN" },
    });
  }
  return { userId: user.id, email: user.email, createdStaff: !staff };
}
