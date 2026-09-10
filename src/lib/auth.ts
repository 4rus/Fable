import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { loginSchema } from "@/lib/validation/auth";
import { getClientIp } from "@/lib/rate-limit";
import { verifyCredentials } from "@/server/services/login";
import { verifyTwoFactorCode } from "@/server/services/twoFactor";

/**
 * AUTHENTICATION (answers "who are you?"), not authorization.
 * Authorization ("are you allowed to do this?") is enforced separately and
 * explicitly in src/server/tenant.ts on every business-scoped operation —
 * never inferred from the fact that a session exists.
 *
 * Session strategy: signed JWT in an httpOnly/secure/sameSite cookie
 * (Auth.js default for the Credentials provider). Trade-off, documented:
 * a JWT session can't be instantly revoked server-side the way a DB
 * session can. Acceptable for MVP; if we need immediate revocation
 * (e.g. "log out all devices" after a password change), the documented
 * P1 path is switching to database sessions via the Prisma adapter.
 *
 * Two-factor auth: password verification lives in
 * src/server/services/login.ts (verifyCredentials), shared with the
 * pre-signIn checkCredentialsAction the login form calls first to decide
 * whether to show a code field — see that file's comment for why sharing
 * it matters for rate-limiting. If the account has 2FA enabled, a valid
 * `totpCode` credential (checked against a live TOTP code OR an unused
 * backup code) is required in the SAME authorize() call as the password;
 * there's no separate "logged in but not fully" session state — you're
 * either fully authenticated or not authenticated at all.
 */
export const authOptions: AuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totpCode: { label: "Two-factor code", type: "text" },
      },
      async authorize(raw, req) {
        // Never trust client input, even for auth fields. Validate shape
        // before touching the database.
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const ip = getClientIp(new Headers(req.headers as HeadersInit));
        const user = await verifyCredentials(email, password, ip);
        if (!user) return null;

        if (user.twoFactorEnabled) {
          const totpCode = typeof raw?.totpCode === "string" ? raw.totpCode : "";
          // Same generic failure as a wrong password — a bare "code
          // required" vs. "code wrong" distinction isn't sensitive here
          // (the caller already proved they know the password to get this
          // far), but there's no reason to hand back anything more
          // specific than NextAuth's own generic CredentialsSignin error.
          const codeValid = totpCode !== "" && (await verifyTwoFactorCode(user.id, totpCode));
          if (!codeValid) return null;
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.userId as string;
      }
      return session;
    },
  },
};
