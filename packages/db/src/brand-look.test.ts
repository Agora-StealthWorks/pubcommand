import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { syncAllBrandLooks, syncBrandLook } from "./brand-look";
import { rawPrisma } from "./client";

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
let orgId = "";
let planId = "";

afterAll(async () => {
  if (orgId) await db.organization.deleteMany({ where: { id: orgId } });
  if (planId) await db.plan.deleteMany({ where: { id: planId } });
});

const lightArtwork = new Uint8Array([1, 2, 3]);
const darkArtwork = new Uint8Array([9, 9, 9, 9]);

describe("brand look for form themes and Mini-Blogs", () => {
  it("copies colors, the logo made for the header and the logo size into followers only, and is idempotent", async () => {
    planId = (await db.plan.create({ data: { key: `look-${suffix}`, name: "Look", seatLimit: 1, monthlyPriceCents: 0 } })).id;
    orgId = (await db.organization.create({ data: { name: "Look", slug: `look-${suffix}`, planId, seatLimit: 1 } })).id;
    const brand = await db.brand.create({ data: { organizationId: orgId, name: "Maha Movie", slug: "maha" } });
    await db.pubBrandBranding.create({
      data: {
        organizationId: orgId,
        brandId: brand.id,
        primaryColor: "#1E3A2B",
        accentColor: "#F5B400",
        logoSize: "Large",
        logoFilename: "light.png",
        logoMime: "image/png",
        logoData: Buffer.from(lightArtwork),
        logoOnDarkFilename: "dark.png",
        logoOnDarkMime: "image/png",
        logoOnDarkData: Buffer.from(darkArtwork),
      },
    });
    const following = await db.formTheme.create({ data: { organizationId: orgId, brandId: brand.id, name: "Brand", privacyPolicyUrl: "", followBrand: true } });
    const custom = await db.formTheme.create({ data: { organizationId: orgId, brandId: brand.id, name: "Custom", privacyPolicyUrl: "", barColor: "#ff0000" } });
    const site = await db.textSite.create({ data: { organizationId: orgId, brandId: brand.id, name: "Alerts", slug: `alerts-${suffix}`, followBrand: true, logoUrl: "https://example.com/old.png" } });

    expect(await syncBrandLook(orgId, brand.id)).toEqual({ themes: 1, sites: 1 });

    const theme = await db.formTheme.findUniqueOrThrow({ where: { id: following.id } });
    expect(theme).toMatchObject({ barColor: "#1e3a2b", accentColor: "#f5b400", logoHeight: 56, logoUrl: null });
    // A dark header gets the logo made for dark backgrounds.
    const themeLogo = await db.formFile.findUniqueOrThrow({ where: { id: theme.logoFileId! } });
    expect(new Uint8Array(themeLogo.data)).toEqual(darkArtwork);
    expect((await db.formTheme.findUniqueOrThrow({ where: { id: custom.id } })).barColor).toBe("#ff0000");

    const blog = await db.textSite.findUniqueOrThrow({ where: { id: site.id } });
    expect(blog).toMatchObject({ headerBg: "#1e3a2b", accentColor: "#f5b400", logoHeight: 56, logoUrl: null });
    expect(new Uint8Array((await db.funnelAsset.findUniqueOrThrow({ where: { id: blog.logoAssetId! } })).data)).toEqual(darkArtwork);

    // Nothing changed: nothing is written, and the logo is not stored again.
    expect(await syncBrandLook(orgId, brand.id)).toEqual({ themes: 0, sites: 0 });
    expect(await db.formFile.count({ where: { organizationId: orgId, kind: "logo" } })).toBe(1);

    // A light header switches to the light-background logo; the old file is removed.
    await db.pubBrandBranding.updateMany({ where: { brandId: brand.id }, data: { primaryColor: "#FFFFFF", logoSize: "Small" } });
    const all = await syncAllBrandLooks();
    expect(all.themes).toBeGreaterThanOrEqual(1);
    const relit = await db.formTheme.findUniqueOrThrow({ where: { id: following.id } });
    expect(relit).toMatchObject({ barColor: "#ffffff", logoHeight: 28 });
    expect(new Uint8Array((await db.formFile.findUniqueOrThrow({ where: { id: relit.logoFileId! } })).data)).toEqual(lightArtwork);
    expect(await db.formFile.count({ where: { organizationId: orgId, kind: "logo" } })).toBe(1);
  });
});
