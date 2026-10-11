import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as t from "@/db/schema";
import { agreementStats, computeEmployeeMonth, dayTypeOf, DAY_TYPE_LABEL, getHolidayMap, getSettings, isMonthClosed, monthRequests, percentOfLimit } from "@/lib/payroll";
import { currentYm, fmtDateShort, fmtMinutes, fmtYen, fmtYm, hmOf, isValidYm, monthBounds, shiftYm } from "@/lib/time";
import { Flash, one, type SP } from "@/components/flash";
import { IconLeft, IconRight } from "@/components/icons";
import { cancelApproved, correctRecord } from "../../actions";

export const metadata = { title: "社員別詳細" };

export default async function EmployeeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const emp = await db.query.employees.findFirst({ where: eq(t.employees.id, id) });
  if (!emp) notFound();
  const m = one(sp.m);
  const ym = isValidYm(m) ? m : currentYm();
  const to = `/admin/employees/${id}?m=${ym}`;

  const [settings, month, requests, closed, stats] = await Promise.all([
    getSettings(),
    computeEmployeeMonth(emp, ym),
    monthRequests(id, ym),
    isMonthClosed(ym),
    agreementStats(emp, ym),
  ]);
  const { first, last } = monthBounds(ym);
  const holidays = await getHolidayMap(first, last);
  const logs = await db.select().from(t.changeLogs).where(eq(t.changeLogs.targetTable, "time_records")).orderBy(desc(t.changeLogs.changedAt)).limit(200);
  const recIds = new Set(requests.map((r) => r.timeRecord?.id).filter(Boolean));
  const myLogs = logs.filter((l) => recIds.has(l.targetId)).slice(0, 10);
  const admins = new Map((await db.select().from(t.employees)).map((e) => [e.id, e.name]));
  const pct = percentOfLimit(month.totals.statutoryMinutes, settings.limitMonthMinutes);
  const yearPct = percentOfLimit(stats.yearMinutes, settings.limitYearMinutes);

  return (
    <>
      <header className="between" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <div className="stack" style={{ gap: 2 }}>
          <Link href="/admin/employees" className="small">← 社員マスタ</Link>
          <h1>{emp.name}</h1>
          <p className="small muted mono">{emp.email}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link href={`/admin/employees/${id}?m=${shiftYm(ym, -1)}`} className="btn" aria-label="前の月" style={{ minWidth: 40, padding: 0 }}><IconLeft size={18} /></Link>
          <strong>{fmtYm(ym)}</strong>
          <Link href={`/admin/employees/${id}?m=${shiftYm(ym, 1)}`} className="btn" aria-label="次の月" style={{ minWidth: 40, padding: 0 }}><IconRight size={18} /></Link>
          {closed && <span className="chip ok">確定済</span>}
        </div>
      </header>
      <Flash msg={one(sp.msg)} err={one(sp.err)} />

      <section className="grid3">
        <div className="stat"><span className="xs muted">時間外（月上限 {fmtMinutes(settings.limitMonthMinutes)}）</span><span className="v">{fmtMinutes(month.totals.statutoryMinutes)}</span><span className="xs muted">{pct}%</span></div>
        <div className="stat"><span className="xs muted">残業代</span><span className="v">{month.amount === null ? "—" : fmtYen(month.amount)}</span><span className="xs muted">{month.hourlyRate === null ? "給与マスタ未登録" : `時間単価 ${fmtYen(month.hourlyRate)}`}</span></div>
        <div className="stat"><span className="xs muted">年間累計（{stats.startYm}〜）</span><span className="v">{fmtMinutes(stats.yearMinutes)}</span><span className="xs muted">年上限 {fmtMinutes(settings.limitYearMinutes)} の {yearPct}%・月上限超え {stats.over45Count}回</span></div>
        <div className="stat"><span className="xs muted">2〜6か月平均の最大（休日労働含む）</span><span className="v" style={{ color: stats.maxAvgMinutes > 80 * 60 ? "var(--bad)" : undefined }}>{fmtMinutes(stats.maxAvgMinutes)}</span><span className="xs muted">上限 80:00</span></div>
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <h2>日別の申請・打刻</h2>
        {requests.length === 0 && <p className="card muted">この月の申請はありません。</p>}
        {requests.map((r) => {
          const rec = r.timeRecord;
          const dt = dayTypeOf(r.workDate, settings, holidays);
          const chip = { PENDING: ["wait", "申請中"], APPROVED: ["ok", "承認済"], REJECTED: ["bad", "却下"], CANCELED: ["off", "取消"] }[r.status];
          return (
            <div key={r.id} className="card stack" style={{ gap: 10 }}>
              <div className="row" style={{ gap: "8px 20px" }}>
                <strong style={{ minWidth: 90 }}>{fmtDateShort(r.workDate)}</strong>
                <span className={`chip ${chip[0]}`}>{chip[1]}</span>
                {dt !== "workday" && <span className="chip wait">{DAY_TYPE_LABEL[dt]}</span>}
                {r.isAfterTheFact && <span className="chip bad">事後申請</span>}
                <span className="mono small">予定 {hmOf(r.plannedStart)}–{hmOf(r.plannedEnd)}</span>
                <span className="mono small">
                  打刻 {rec ? `${hmOf(rec.startedAt)}–${rec.endedAt ? hmOf(rec.endedAt) : "--:--"}` : "なし"}
                  {rec && rec.breakMinutes > 0 && `（休憩${rec.breakMinutes}分）`}
                </span>
                {rec?.corrected && <span className="chip off">修正済</span>}
                {rec?.excessStatus === "PENDING" && <span className="chip warn">超過 承認待ち</span>}
                {rec?.excessStatus === "REJECTED" && <span className="chip off">超過 計上しない</span>}
              </div>
              <div className="small">{r.task}<span className="muted">　{r.reason}</span></div>
              {rec?.correctionRequest && <p className="note warn">本人からの修正依頼：{rec.correctionRequest}</p>}

              {!closed && (rec || r.status === "APPROVED") && (
                <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                  {rec && (
                    <details>
                      <summary className="btn sm" style={{ listStyle: "none" }}>打刻を修正</summary>
                      <form action={correctRecord} className="stack card" style={{ marginTop: 8, minWidth: 300, border: "1px solid var(--line)" }}>
                        <input type="hidden" name="recordId" value={rec.id} />
                        <input type="hidden" name="to" value={to} />
                        <div className="grid2">
                          <div className="field"><label htmlFor={`s-${rec.id}`}>開始</label><input id={`s-${rec.id}`} name="start" type="time" defaultValue={hmOf(rec.startedAt)} className="input mono" required /></div>
                          <div className="field"><label htmlFor={`e-${rec.id}`}>終了</label><input id={`e-${rec.id}`} name="end" type="time" defaultValue={rec.endedAt ? hmOf(rec.endedAt) : hmOf(r.plannedEnd)} className="input mono" required /></div>
                        </div>
                        <div className="field"><label htmlFor={`b-${rec.id}`}>休憩（分）</label><input id={`b-${rec.id}`} name="breakMinutes" type="number" min={0} max={600} step={5} defaultValue={rec.breakMinutes} className="input num" /></div>
                        <div className="field"><label htmlFor={`rs-${rec.id}`}>修正の理由 <span className="req">必須</span></label><input id={`rs-${rec.id}`} name="reason" className="input" required /></div>
                        <button type="submit" className="btn primary sm">修正する</button>
                      </form>
                    </details>
                  )}
                  {r.status === "APPROVED" && (
                    <details>
                      <summary className="btn sm danger" style={{ listStyle: "none" }}>承認を取り消す</summary>
                      <form action={cancelApproved} className="stack card" style={{ marginTop: 8, minWidth: 300, border: "1px solid var(--line)" }}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="to" value={to} />
                        <div className="field"><label htmlFor={`c-${r.id}`}>取り消す理由 <span className="req">必須</span></label><input id={`c-${r.id}`} name="reason" className="input" required /></div>
                        <button type="submit" className="btn sm danger">取り消す</button>
                      </form>
                    </details>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {myLogs.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h2>打刻の変更履歴</h2>
          <div className="tablewrap">
            <table className="tb" style={{ minWidth: 560 }}>
              <thead><tr><th>日時</th><th>変更者</th><th>理由</th></tr></thead>
              <tbody>
                {myLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="mono small">{l.changedAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                    <td>{admins.get(l.changedById) ?? "不明"}</td>
                    <td>{l.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
