import type { PrismaClient } from "@pubcommand/db";
import { Lucia, TimeSpan, type Session, type User } from "lucia";
import { authCookieBase, SESSION_COOKIE } from "./cookies";

export type AuthDatabase = Pick<PrismaClient, "session">;

export function createLucia(db: AuthDatabase) {
  const cookie = authCookieBase();
  return new Lucia(
    {
      async getSessionAndUser(sessionId: string) {
        const row = await db.session.findUnique({
          where: { id: sessionId },
          include: { user: true },
        });
        if (!row) return [null, null];
        return [
          {
            id: row.id,
            userId: row.userId,
            expiresAt: row.expiresAt,
            attributes: { mfaVerified: row.mfaVerified },
          },
          {
            id: row.user.id,
            attributes: { email: row.user.email, name: row.user.name },
          },
        ];
      },
      async getUserSessions(userId: string) {
        const rows = await db.session.findMany({ where: { userId } });
        return rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          expiresAt: row.expiresAt,
          attributes: { mfaVerified: row.mfaVerified },
        }));
      },
      async setSession(session) {
        await db.session.create({
          data: {
            id: session.id,
            userId: session.userId,
            expiresAt: session.expiresAt,
            mfaVerified: Boolean(session.attributes.mfaVerified),
          },
        });
      },
      async updateSessionExpiration(sessionId: string, expiresAt: Date) {
        await db.session.update({ where: { id: sessionId }, data: { expiresAt } });
      },
      async deleteSession(sessionId: string) {
        await db.session.delete({ where: { id: sessionId } }).catch(() => undefined);
      },
      async deleteUserSessions(userId: string) {
        await db.session.deleteMany({ where: { userId } });
      },
      async deleteExpiredSessions() {
        await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      },
    },
    {
      sessionExpiresIn: new TimeSpan(30, "d"),
      sessionCookie: {
        name: SESSION_COOKIE,
        expires: false,
        attributes: cookie,
      },
      getUserAttributes: (attributes) => ({
        email: attributes.email,
        name: attributes.name,
      }),
      getSessionAttributes: (attributes) => ({
        mfaVerified: attributes.mfaVerified,
      }),
    },
  );
}

export type AppLucia = ReturnType<typeof createLucia>;

declare module "lucia" {
  interface Register {
    Lucia: AppLucia;
    DatabaseUserAttributes: {
      email: string;
      name: string | null;
    };
    DatabaseSessionAttributes: {
      mfaVerified: boolean;
    };
  }
}

export type AuthSession = Session;
export type AuthUser = User;
