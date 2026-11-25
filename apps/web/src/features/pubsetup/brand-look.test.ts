import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { rawPrisma } from "@pubcommand/db";
import { brandLook } from "./brand-look";

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
let orgId = "";
let planId = "";

afterAll(async () => {
  if (orgId) await db.organization.deleteMany({ where: { id: orgId } });
  if (planId) await db.plan.deleteMany({ where: { id: planId } });
});

describe("brand look for new forms and Mini-Blogs", () => {
  it("uses the brand's colors and the logo made for its header, with defaults for what is missing", async () => {
    planId = (await db.plan.create({ data: { key: `bl-${suffix}`, name: "BL", seatLimit: 1, monthlyPriceCents: 0 } })).id;
    orgId = (await db.organization.create({ data: { name: "BL", slug: `bl-${suffix}`, planId, seatLimit: 1 } })).id;
    const brand = await db.brand.create({ data: { organizationId: orgId, name: "Acme Health", slug: "acme" } });
    const defaults = { headerColor: "#111827", accentColor: "#1d4ed8" };

    expect(await brandLook(orgId, brand, defaults)).toEqual({ ...defaults, companyName: "Acme Health", logo: null });

    await db.pubBrandBranding.create({
      data: {
        organizationId: orgId,
        brandId: brand.id,
        primaryColor: "#1E1B4B",
        accentColor: "#7c3aed",
        logoFilename: "dark-text.png",
        logoMime: "image/png",
        logoData: new Uint8Array([1]),
        logoOnDarkFilename: "light-text.svg",
        logoOnDarkMime: "image/svg+xml",
        logoOnDarkData: new Uint8Array([2]),
      },
    });
    const look = await brandLook(orgId, brand, defaults);
    expect(look).toMatchObject({ headerColor: "#1e1b4b", accentColor: "#7c3aed", companyName: "Acme Health" });
    // A dark header gets the logo made for dark backgrounds.
    expect(look.logo).toMatchObject({ filename: "light-text.svg", mime: "image/svg+xml" });
  });
});
