import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/db/schema";
import { Flash, one, type SP } from "@/components/flash";
import { currentYm } from "@/lib/time";
import { allowedDomains, domainsLabel } from "@/lib/domains";
import { saveEmployee, setEmployeeActive } from "../actions";

export const metadata = { title: "社員マスタ" };

export default async function EmployeesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const list = await db.select().from(employees).orderBy(desc(employees.isActive), asc(employees.name));
  const domain = domainsLabel();
  const firstDomain = allowedDomains()[0];

  return (
    <>
      <header className="stack" style={{ gap: 4 }}>
        <h1>社員マスタ</h1>
        <p className="small muted">ここに登録したGoogleアカウントだけがログインできます。{domain && `（${domain}）`}</p>
      </header>
      <Flash msg={one(sp.msg)} err={one(sp.err)} />

      <section className="tablewrap">
        <table className="tb" style={{ minWidth: 760 }}>
          <thead>
            <tr><th>氏名</th><th>メールアドレス</th><th>部署</th><th>権限</th><th>状態</th><th>操作</th></tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} style={e.isActive ? undefined : { opacity: 0.6 }}>
                <td style={{ fontWeight: 700 }}>
                  <Link href={`/admin/employees/${e.id}?m=${currentYm()}`} style={{ color: "var(--ink)" }}>{e.name}</Link>
                </td>
                <td className="mono small">{e.email}</td>
                <td>{e.department ?? "—"}</td>
                <td>{e.role === "ADMIN" ? <span className="chip wait">管理者</span> : "社員"}</td>
                <td>{e.isActive ? <span className="chip ok">在籍</span> : <span className="chip off">退職</span>}</td>
                <td>
                  <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
                    <details>
                      <summary className="btn sm" style={{ listStyle: "none" }}>編集</summary>
                      <form action={saveEmployee} className="stack card" style={{ marginTop: 8, minWidth: 260, border: "1px solid var(--line)" }}>
                        <input type="hidden" name="id" value={e.id} />
                        <div className="field"><label htmlFor={`n-${e.id}`}>氏名</label><input id={`n-${e.id}`} name="name" defaultValue={e.name} className="input" required /></div>
                        <div className="field"><label htmlFor={`m-${e.id}`}>メールアドレス</label><input id={`m-${e.id}`} name="email" type="email" defaultValue={e.email} className="input" required /></div>
                        <div className="field"><label htmlFor={`d-${e.id}`}>部署</label><input id={`d-${e.id}`} name="department" defaultValue={e.department ?? ""} className="input" /></div>
                        <div className="field">
                          <label htmlFor={`r-${e.id}`}>権限</label>
                          <select id={`r-${e.id}`} name="role" defaultValue={e.role} className="select">
                            <option value="MEMBER">社員</option>
                            <option value="ADMIN">管理者</option>
                          </select>
                        </div>
                        <button type="submit" className="btn primary sm">保存</button>
                      </form>
                    </details>
                    <form action={setEmployeeActive}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="active" value={e.isActive ? "0" : "1"} />
                      <button type="submit" className="btn sm">{e.isActive ? "退職にする" : "在籍に戻す"}</button>
                    </form>
                    <Link href={`/admin/salary?e=${e.id}`} className="btn sm">給与</Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card stack" style={{ maxWidth: 520 }}>
        <h2>社員を追加</h2>
        <form action={saveEmployee} className="stack">
          <div className="field"><label htmlFor="new-name">氏名</label><input id="new-name" name="name" className="input" required /></div>
          <div className="field"><label htmlFor="new-email">会社のGoogleアドレス</label><input id="new-email" name="email" type="email" className="input" placeholder={firstDomain ? `taro@${firstDomain}` : "taro@example.com"} required /></div>
          <div className="field"><label htmlFor="new-dept">部署（任意）</label><input id="new-dept" name="department" className="input" /></div>
          <div className="field">
            <label htmlFor="new-role">権限</label>
            <select id="new-role" name="role" className="select" defaultValue="MEMBER">
              <option value="MEMBER">社員</option>
              <option value="ADMIN">管理者</option>
            </select>
          </div>
          <button type="submit" className="btn primary">追加する</button>
        </form>
      </section>
    </>
  );
}
