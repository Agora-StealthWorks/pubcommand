import { DEFAULT_SUPERADMIN_EMAIL, normalizeEmail } from "./email";
import { rawPrisma } from "./client";

export async function ensureSuperadmin(email = process.env.SUPERADMIN_EMAIL || DEFAULT_SUPERADMIN_EMAIL) {
  const normalized = normalizeEmail(email);
  const existing = await rawPrisma().user.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" } },
  });
  const user =
    existing ??
    (await rawPrisma().user.create({
      data: {
        email: normalized,
        name: "Stephen Prior",
        passwordHash: null,
      },
    }));
  const staff = await rawPrisma().platformStaff.findUnique({ where: { userId: user.id } });
  if (!staff) {
    await rawPrisma().platformStaff.create({
      data: { userId: user.id, role: "SUPER_ADMIN" },
    });
  }
  return { userId: user.id, email: user.email, createdStaff: !staff };
}
