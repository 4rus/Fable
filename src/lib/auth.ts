import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validation/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logWarn } from "@/lib/logger";

const LOGIN_LIMIT = 10; // attempts
const LOGIN_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes

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
      },
      async authorize(raw, req) {
        // Never trust client input, even for auth fields. Validate shape
        // before touching the database.
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Brute-force protection. Keyed on IP+email together (not just
        // email) so an attacker can't lock a real user out by hammering
        // their address from many IPs into one shared bucket, and a
        // shared/corporate IP with many legitimate users isn't starved by
        // one person's typos. On limit exceeded we fall through to the
        // SAME generic failure as a wrong password — revealing "you're
        // rate-limited" vs "that password is wrong" would itself be an
        // oracle an attacker could use to enumerate valid emails.
        const ip = getClientIp(new Headers(req.headers as HeadersInit));
        const rate = checkRateLimit(`login:${ip}:${email.toLowerCase()}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
        if (!rate.allowed) {
          logWarn("login rate limit exceeded", { ip, email: email.toLowerCase() });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        });
        // Deliberately generic failure path: do the bcrypt compare against
        // a dummy hash even when no user exists, so response timing doesn't
        // leak which emails are registered (basic enumeration resistance).
        const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
        const valid = await bcrypt.compare(password, hashToCompare);
        if (!user || !valid) return null;

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

// A real bcrypt hash of a random value, used only to equalize timing when
// no matching user is found. Never a real credential.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8lqfyd1rG4XX9EbeM.0DFhrN3VYW7C";
