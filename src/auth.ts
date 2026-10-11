import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/db/schema";

const findByEmail = (email: string) => db.query.employees.findFirst({ where: eq(employees.email, email.toLowerCase()) });

const allowedDomain = (process.env.ALLOWED_DOMAIN ?? "").toLowerCase();

/** 開発用ログインは NODE_ENV=production では常に無効 */
export const devLoginEnabled = process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN === "true";

const providers: Provider[] = [
  Google({
    authorization: {
      params: {
        prompt: "select_account",
        // Googleのアカウント選択画面を自社ドメインに絞る（最終的な判定は signIn で行う）
        ...(allowedDomain ? { hd: allowedDomain } : {}),
      },
    },
  }),
];

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "開発用ログイン",
      credentials: { email: { label: "メール" } },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase();
        const emp = await findByEmail(email);
        if (!emp || !emp.isActive) return null;
        return { id: emp.id, email: emp.email, name: emp.name };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider === "dev") return devLoginEnabled;
      if (account?.provider !== "google") return false;

      const email = String(profile?.email ?? user?.email ?? "").toLowerCase();
      if (!profile?.email_verified) return "/login?error=unverified";
      if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) return "/login?error=domain";

      const emp = await findByEmail(email);
      if (!emp || !emp.isActive) return "/login?error=not_registered";
      return true;
    },
  },
});
