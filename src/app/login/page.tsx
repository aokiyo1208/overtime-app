import { redirect } from "next/navigation";
import { auth, devLoginEnabled, signIn } from "@/auth";
import { BrandMark, IconLogin } from "@/components/icons";
import { one, type SP } from "@/components/flash";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/db/schema";
import { findEmployeeByEmail } from "@/lib/session";

export const metadata = { title: "ログイン" };

const ERRORS: Record<string, string> = {
  domain: "会社のGoogleアカウントでログインしてください。",
  not_registered: "このアカウントは社員として登録されていません。管理者（総務）に登録を依頼してください。",
  unverified: "メールアドレスが確認されていないアカウントです。",
  AccessDenied: "ログインできませんでした。管理者（総務）に社員登録を依頼してください。",
  CredentialsSignin: "開発用ログインに失敗しました。",
};

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const session = await auth();
  if (session?.user?.email) {
    const emp = await findEmployeeByEmail(session.user.email);
    if (emp?.isActive) redirect("/");
  }
  const sp = await searchParams;
  const error = one(sp.error);
  const domain = process.env.ALLOWED_DOMAIN;
  const devUsers = devLoginEnabled
    ? await db.select().from(employees).where(eq(employees.isActive, true)).orderBy(desc(employees.role), asc(employees.name))
    : [];

  return (
    <div className="m-shell" style={{ padding: "56px 24px 32px", justifyContent: "space-between", gap: 32 }}>
      <div className="row" style={{ gap: 10 }}>
        <BrandMark size={36} />
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.04em" }}>残業申請</span>
      </div>

      <div className="stack" style={{ gap: 28 }}>
        <div className="stack">
          <h1 style={{ fontSize: 30, lineHeight: 1.35 }}>
            残業の申請と打刻を、
            <br />
            ここで行います
          </h1>
          <p className="muted">会社のGoogleアカウントでログインしてください。</p>
        </div>

        {error && (
          <p className="flash err" role="alert">
            {ERRORS[error] ?? "ログインできませんでした。もう一度お試しください。"}
          </p>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button type="submit" className="btn block" style={{ borderColor: "var(--ink)", minHeight: 56 }}>
            <IconLogin /> Googleでログイン
          </button>
        </form>

        {domain && <p className="note">@{domain} のアカウントのみ利用できます。</p>}

        {devLoginEnabled && (
          <form
            className="card stack"
            action={async (fd: FormData) => {
              "use server";
              await signIn("dev", { email: String(fd.get("email") ?? ""), redirectTo: "/" });
            }}
          >
            <div className="field">
              <label htmlFor="dev-email">開発用ログイン（ローカルのみ）</label>
              <select id="dev-email" name="email" className="select" required>
                {devUsers.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.name}（{u.role === "ADMIN" ? "管理者" : "社員"}）
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn">この社員でログイン</button>
            <p className="xs muted">.env の DEV_LOGIN を消すと表示されなくなります。本番では常に無効です。</p>
          </form>
        )}
      </div>

      <p className="xs muted">ログインできない場合は、管理者（総務）に社員登録を依頼してください。</p>
    </div>
  );
}
