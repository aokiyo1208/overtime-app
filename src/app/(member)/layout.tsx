import Link from "next/link";
import { MemberNav } from "@/components/member-nav";
import { requireUser } from "@/lib/session";
import { signOut } from "@/auth";

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return (
    <div className="m-shell">
      <div className="row" style={{ justifyContent: "flex-end", padding: "10px 20px 0", fontSize: 13 }}>
        {me.role === "ADMIN" && <Link href="/admin/approvals">管理者画面へ</Link>}
        <span className="muted">{me.name}</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="linkbtn" style={{ minHeight: 32, fontWeight: 500, fontSize: 13 }}>ログアウト</button>
        </form>
      </div>
      {children}
      <MemberNav />
    </div>
  );
}
