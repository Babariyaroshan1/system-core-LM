import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { createHash } from "node:crypto";
import type { Collection } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { LoginAttemptDocument, UserDocument } from "@/lib/models";
import { verifyPassword } from "@/lib/passwords";
import { z } from "zod";

const credentialsSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});
const dummyPasswordHash =
  "$2b$12$It0.934x2gQEMy6a8bdze.fXVjL7M3XJyl71ltWhyUafc..AiA4/m";
const loginWindowMs = 15 * 60 * 1000;
const loginLimit = 5;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Username and password",
      credentials: {
        identifier: { label: "Username or email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const identifier = parsed.data.identifier.toLowerCase();
        const headers = request?.headers ?? {};
        const forwardedFor = headers["x-forwarded-for"]?.split(",")[0]?.trim();
        const remoteAddress = headers["x-real-ip"]?.trim() ?? "unknown";
        const attemptKey = createHash("sha256")
          .update(`${identifier}:${forwardedFor || remoteAddress}`)
          .digest("hex");
        const db = await getDb();
        const attempts = db.collection<LoginAttemptDocument>("loginAttempts");
        const now = new Date();
        const previousAttempts = await attempts.findOne({ _id: attemptKey });
        if (
          previousAttempts?.blockedUntil &&
          previousAttempts.blockedUntil > now
        )
          return null;

        const matches = await db.collection<UserDocument>("users")
          .find({
            active: true,
            $or: [
              { usernameNormalized: identifier },
              { emailNormalized: identifier },
            ],
          })
          .limit(2)
          .toArray();
        const user = matches.length === 1 ? matches[0] : null;
        const passwordMatches = await verifyPassword(
          parsed.data.password,
          user?.passwordHash ?? dummyPasswordHash,
        );
        if (!user?.passwordHash || !passwordMatches) {
          await recordFailedLogin(attempts, attemptKey, previousAttempts, now);
          return null;
        }

        await attempts.deleteOne({ _id: attemptKey });
        return {
          id: user._id.toHexString(),
          email: user.emailNormalized,
          name: user.name,
        };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email.trim().toLowerCase();
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.email) session.user.email = String(token.email);
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
  useSecureCookies: process.env.NODE_ENV === "production",
};

async function recordFailedLogin(
  collection: Collection<LoginAttemptDocument>,
  key: string,
  previous: LoginAttemptDocument | null,
  now: Date,
) {
  const windowExpired =
    !previous ||
    now.getTime() - previous.windowStartedAt.getTime() >= loginWindowMs;
  const attempts = windowExpired ? 1 : previous.attempts + 1;
  const windowStartedAt = windowExpired ? now : previous.windowStartedAt;
  const expiresAt = new Date(now.getTime() + loginWindowMs * 2);
  const update = {
    $set: {
      attempts,
      windowStartedAt,
      expiresAt,
      ...(attempts >= loginLimit
        ? { blockedUntil: new Date(now.getTime() + loginWindowMs) }
        : {}),
    },
    ...(windowExpired ? { $unset: { blockedUntil: "" as const } } : {}),
  };
  await collection.updateOne({ _id: key }, update, { upsert: true });
}

export const authHandler = NextAuth(authOptions);
