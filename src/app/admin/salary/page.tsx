import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as t from "@/db/schema";
import { getSettings } from "@/lib/payroll";
import { avgMonthlyMinutes, hourlyRate } from "@/lib/overtime";
import { fmtYen } from "@/lib/time";
import { Flash, one, type SP } from "@/components/flash";
import { BackLink } from "@/components/back-link";
import { saveSalary } from "../actions";

export const metadata = { title: "給与マスタ" };

export default async function SalaryPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const settings = await getSettings();
  const emps = await db.select().from(t.employees).orderBy(desc(t.employees.isActive), asc(t.employees.name));
  const selectedId = one(sp.e) ?? emps[0]?.id;
  const selected = emps.find((e) => e.id === selectedId) ?? emps[0];

  const all = await db.select().from(t.salaries).orderBy(desc(t.salaries.effectiveFrom), desc(t.salaries.createdAt));
  const latest = new Map<string, (typeof all)[number]>();
  for (const s of all) if (!latest.has(s.employeeId)) latest.set(s.employeeId, s);
  const history = selected ? await db.select().from(t.salaries).where(eq(t.salaries.employeeId, selected.id)).orderBy(desc(t.salaries.effectiveFrom), desc(t.salaries.createdAt)) : [];
  const cur = selected ? latest.get(selected.id) : undefined;
  const avgHours = avgMonthlyMinutes(settings) / 60;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="stack" style={{ gap: 4 }}>
        {one(sp.e) ? <BackLink href="/admin/employees">社員マスタに戻る</BackLink> : <BackLink href="/admin/approvals">承認待ちに戻る</BackLink>}
        <h1>給与マスタ</h1>
        <p className="small muted">
          月平均所定労働時間 {avgHours.toFixed(2)}時間（年間休日{settings.annualHolidays}日・1日{settings.dailyMinutes / 60}時間）で時間単価を計算しています。
        </p>
      </header>
      <Flash msg={one(sp.msg)} err={one(sp.err)} />

      <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
        <section className="tablewrap" style={{ flex: "999 1 520px", minWidth: 0 }}>
          <table className="tb" style={{ minWidth: 620 }}>
            <thead>
              <tr><th>社員</th><th>形態</th><th style={{ textAlign: "right" }}>基本給・時給</th><th style={{ textAlign: "right" }}>算入手当</th><th style={{ textAlign: "right" }}>時間単価</th><th>適用開始日</th></tr>
            </thead>
            <tbody>
              {emps.map((e) => {
                const s = latest.get(e.id);
                const sel = e.id === selected?.id;
                return (
                  <tr key={e.id} style={{ background: sel ? "var(--accent-wash)" : undefined, opacity: e.isActive ? 1 : 0.6 }}>
                    <td style={{ fontWeight: 700 }}><Link href={`/admin/salary?e=${e.id}`} style={{ color: "var(--ink)" }}>{e.name}</Link></td>
                    <td>{s ? (s.payType === "MONTHLY" ? "月給" : "時給") : <span className="chip warn">未登録</span>}</td>
                    <td className="r">{s ? fmtYen(s.payType === "MONTHLY" ? s.basePay : (s.hourlyWage ?? 0)) : "—"}</td>
                    <td className="r">{s ? (s.payType === "MONTHLY" ? fmtYen(s.includedAllowances) : "—") : "—"}</td>
                    <td className="r">{s ? `¥${hourlyRate(s, settings).toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
                    <td className="mono small">{s?.effectiveFrom ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {selected && (
          <section className="card stack" style={{ flex: "1 1 320px", minWidth: 0 }}>
            <div className="between"><h2 style={{ fontSize: 17 }}>{selected.name}</h2><span className="xs muted">給与改定を追加</span></div>
            <form action={saveSalary} className="stack" style={{ gap: 14 }}>
              <input type="hidden" name="employeeId" value={selected.id} />
              <fieldset style={{ margin: 0, padding: 0, border: "none" }} className="row">
                <legend className="label" style={{ marginBottom: 6 }}>給与形態</legend>
                <label htmlFor="pt-m" className="row" style={{ gap: 6 }}><input id="pt-m" type="radio" name="payType" value="MONTHLY" defaultChecked={cur?.payType !== "HOURLY"} />月給制</label>
                <label htmlFor="pt-h" className="row" style={{ gap: 6 }}><input id="pt-h" type="radio" name="payType" value="HOURLY" defaultChecked={cur?.payType === "HOURLY"} />時給制</label>
              </fieldset>
              <div className="grid2">
                <div className="field"><label htmlFor="basePay">基本給（円）</label><input id="basePay" name="basePay" type="number" min={0} step={1000} defaultValue={cur?.basePay || ""} className="input num" /></div>
                <div className="field"><label htmlFor="included">単価に含める手当（円）</label><input id="included" name="includedAllowances" type="number" min={0} step={1000} defaultValue={cur?.includedAllowances ?? 0} className="input num" /></div>
              </div>
              <div className="field"><label htmlFor="hourly">時給（時給制のみ・円）</label><input id="hourly" name="hourlyWage" type="number" min={0} step={10} defaultValue={cur?.hourlyWage ?? ""} className="input num" /></div>
              <div className="field"><label htmlFor="from">適用開始日</label><input id="from" name="effectiveFrom" type="date" defaultValue={today} className="input" required /></div>
              <div className="field"><label htmlFor="note">メモ（任意）</label><input id="note" name="note" className="input" placeholder="例：2026年度 定期昇給" /></div>
              <p className="xs muted" style={{ lineHeight: 1.7 }}>
                単価に含めない手当（通勤・家族・別居・子女教育・住宅・臨時の賃金・賞与など）は入力しません。
                改定は履歴として追加され、対象月の末日時点で有効な行が使われます。
              </p>
              <button type="submit" className="btn primary" style={{ minHeight: 44 }}>保存</button>
            </form>

            <div className="stack" style={{ gap: 8, paddingTop: 12, borderTop: "1px solid var(--line-2)" }}>
              <span className="label xs">改定履歴</span>
              {history.length === 0 && <span className="small muted">まだ登録がありません。</span>}
              {history.map((h) => (
                <div key={h.id} className="small" style={{ display: "grid", gridTemplateColumns: "92px minmax(0,1fr)", gap: "0 12px" }}>
                  <span className="mono muted">{h.effectiveFrom}</span>
                  <span>
                    {h.payType === "MONTHLY" ? `月給 基本給 ${fmtYen(h.basePay)}・算入手当 ${fmtYen(h.includedAllowances)}` : `時給 ${fmtYen(h.hourlyWage ?? 0)}`}
                    {h.note && <span className="muted">（{h.note}）</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
