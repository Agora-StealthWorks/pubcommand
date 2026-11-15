import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from "@pubcommand/auth";
import { appendPlatformAudit, rawPrisma } from "@pubcommand/db";
import { NextResponse } from "next/server";
import { markSessionMfa, readSession, readStaff, secret } from "@/lib/auth";

export async function POST(request: Request) {
  const auth = await readSession();
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const back = new URL("/2fa", `${proto}://${host}`);
  if (!auth.user || !auth.session) return NextResponse.redirect(new URL("/login", back.origin));
  const staff = await readStaff(auth.user.id);
  if (!staff) return new NextResponse("Platform staff only.", { status: 403 });
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  if (action === "generate") {
    if (!staff.totpSecretCipher) {
      const totpSecret = generateTotpSecret();
      await rawPrisma().platformStaff.update({
        where: { id: staff.id },
        data: { totpSecretCipher: encryptTotpSecret(totpSecret, secret()) },
      });
      await appendPlatformAudit({ actorId: auth.user.id, action: "staff.2fa.enroll_started", targetType: "user", targetId: auth.user.id });
    }
    return NextResponse.redirect(back, 303);
  }
  const code = String(form.get("code") ?? "");
  if (!staff.totpSecretCipher || !verifyTotp(decryptTotpSecret(staff.totpSecretCipher, secret()), code)) {
    await appendPlatformAudit({ actorId: auth.user.id, action: "staff.2fa.challenge_failed", targetType: "user", targetId: auth.user.id });
    back.searchParams.set("error", "That code was not accepted.");
    return NextResponse.redirect(back, 303);
  }
  if (!staff.totpConfirmedAt) {
    await rawPrisma().platformStaff.update({ where: { id: staff.id }, data: { totpConfirmedAt: new Date() } });
    await appendPlatformAudit({ actorId: auth.user.id, action: "staff.2fa.enrolled", targetType: "user", targetId: auth.user.id });
  } else {
    await appendPlatformAudit({ actorId: auth.user.id, action: "staff.2fa.challenge_passed", targetType: "user", targetId: auth.user.id });
  }
  await markSessionMfa(auth.session.id, auth.user.id);
  return NextResponse.redirect(new URL("/", back.origin));
}
