import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { signOut } from "@/auth";
import { db } from "@/lib/db";
import { overtimeRequests, timeRecords } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/admin-nav";
import { BrandMark } from "@/components/icons";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdmin();
  const [[req], [exc]] = await Promise.all([
    db.select({ n: count() }).from(overtimeRequests).where(eq(overtimeRequests.status, "PENDING")),
    db.select({ n: count() }).from(timeRecords).where(eq(timeRecords.excessStatus, "PENDING")),
  ]);
  return (
    <div className="a-shell">
      <aside className="a-side">
        <Link href="/admin/approvals" className="brand">
          <BrandMark />
          <span className="stack" style={{ gap: 0 }}>
            <strong style={{ fontSize: 14 }}>残業申請</strong>
            <span className="xs muted">管理者</span>
          </span>
        </Link>
        <AdminNav pending={(req?.n ?? 0) + (exc?.n ?? 0)} />
        <div className="stack" style={{ marginTop: "auto", gap: 4 }}>
          <Link href="/" className="small">自分の打刻画面へ</Link>
          <span className="xs muted">{me.name}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="linkbtn" style={{ minHeight: 32, fontWeight: 500, fontSize: 13 }}>ログアウト</button>
          </form>
        </div>
      </aside>
      <main className="a-main">{children}</main>
    </div>
  );
}
