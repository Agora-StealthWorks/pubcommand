import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";

/**
 * Opens the organization's dashboard with this brand picked (the site switcher's brand links,
 * which can come from another organization's host). Same cookie as the sidebar brand picker.
 * An unknown brand, or one a brand-limited member cannot use, just opens the dashboard.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; brandId: string }> }) {
  const { slug, brandId } = await params;
  const ctx = await getOrgContext(slug);
  const allowed =
    ctx.kind === "ok" &&
    ctx.brands.some((brand) => brand.id === brandId) &&
    (!ctx.subject.membershipBrandId || ctx.subject.membershipBrandId === brandId);
  if (allowed) {
    (await cookies()).set("pc_brand", brandId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  redirect("/");
}
