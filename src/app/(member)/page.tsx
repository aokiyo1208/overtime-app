import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { overtimeRequests, timeRecords } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { computeEmployeeMonth, getHolidayMap, getSettings, percentOfLimit } from "@/lib/payroll";
import { addDays, currentYm, fmtDateLong, fmtDateShort, fmtMinutes, fmtYen, hmOf, monthBounds, paydayOf, todayYmd } from "@/lib/time";
import { Elapsed } from "@/components/elapsed";
import { Flash, one, type SP } from "@/components/flash";
import { IconAlert, IconCheck, IconPlay, IconStop } from "@/components/icons";
import { endStamp, requestCorrection, startStamp } from "./actions";

export const metadata = { title: "打刻" };

const STATUS = {
  PENDING: { label: "申請中", cls: "wait" },
  APPROVED: { label: "承認済", cls: "ok" },
  REJECTED: { label: "却下", cls: "bad" },
  CANCELED: { label: "取消", cls: "off" },
} as const;

export default async function HomePage({ searchParams }: { searchParams: SP }) {
  const me = await requireUser();
  const sp = await searchParams;
  const today = todayYmd();
  const ym = currentYm();

  const todays = await db.query.overtimeRequests.findMany({
    where: and(eq(overtimeRequests.employeeId, me.id), eq(overtimeRequests.workDate, today), inArray(overtimeRequests.status, ["PENDING", "APPROVED"])),
    with: { timeRecord: true },
    orderBy: overtimeRequests.plannedStart,
  });
  // 前日以前で終了打刻がないもの
  const unfinished = (
    await db.query.timeRecords.findMany({
      where: and(eq(timeRecords.employeeId, me.id), isNull(timeRecords.endedAt)),
      with: { request: true },
      orderBy: desc(timeRecords.startedAt),
    })
  ).filter((r) => r.request.workDate < today && r.request.status !== "REJECTED" && r.request.status !== "CANCELED");

  const settings = await getSettings();
  const { first, last } = monthBounds(ym);
  const holidays = await getHolidayMap(first, addDays(last, 40));
  const month = await computeEmployeeMonth(me, ym, { settings, holidays });
  const pct = percentOfLimit(month.totals.statutoryMinutes, settings.limitMonthMinutes);
  const payday = paydayOf(ym, new Set(holidays.keys()));

  return (
    <>
      <header className="m-head">
        <div>
          <div className="small muted">{today.slice(0, 4)}年</div>
          <h1>{fmtDateLong(today).slice(5)}</h1>
        </div>
      </header>

      <main className="m-main">
        <Flash msg={one(sp.msg)} err={one(sp.err)} />

        {unfinished.map((r) => (
          <details key={r.id} className="note warn">
            <summary>
              <span className="row" style={{ display: "inline-flex" }}>
                <IconAlert size={18} /> {fmtDateShort(r.request.workDate)}の終了打刻がありません
              </span>
            </summary>
            {r.correctionRequest ? (
              <p className="small" style={{ marginTop: 8 }}>修正依頼済み：{r.correctionRequest}</p>
            ) : (
              <form action={requestCorrection} className="stack" style={{ marginTop: 10 }}>
                <input type="hidden" name="recordId" value={r.id} />
                <input type="hidden" name="from" value="/" />
                <label htmlFor={`fix-${r.id}`} className="label">正しい終了時刻と理由</label>
                <input id={`fix-${r.id}`} name="text" className="input" placeholder="例：21:15 終了。押し忘れ" required />
                <button type="submit" className="btn sm">修正を依頼</button>
              </form>
            )}
          </details>
        ))}

        {todays.length === 0 ? (
          <section className="card stack">
            <h2 className="small muted" style={{ fontWeight: 500 }}>今日の残業申請</h2>
            <p>今日の申請はありません。残業する場合は先に申請してください。</p>
            <Link href="/request" className="btn primary">残業を申請する</Link>
          </section>
        ) : (
          todays.map((r) => {
            const rec = r.timeRecord;
            return (
              <div key={r.id} className="stack" style={{ gap: 16 }}>
                <section className="card stack" style={{ gap: 8 }}>
                  <div className="between">
                    <h2 className="small muted" style={{ fontWeight: 500 }}>今日の残業申請</h2>
                    <span className={`chip ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
                    {hmOf(r.plannedStart)} – {hmOf(r.plannedEnd)}
                  </div>
                  <div className="small" style={{ color: "var(--ink-2)" }}>{r.task}</div>
                  {r.status === "PENDING" && <p className="xs muted">承認前でも打刻できます。実績は承認後に計上されます。</p>}
                </section>

                {!rec && (
                  <form action={startStamp} className="stack" style={{ alignItems: "center", gap: 14, padding: "8px 0" }}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="stamp-btn">
                      <IconPlay size={36} color="#fff" />
                      <span>残業を開始</span>
                    </button>
                    <p className="small muted">押した時刻（サーバー時刻）で記録します</p>
                  </form>
                )}

                {rec && !rec.endedAt && (
                  <form action={endStamp} className="stack" style={{ alignItems: "center", gap: 12 }}>
                    <input type="hidden" name="id" value={r.id} />
                    <span className="chip warn" style={{ fontSize: 13 }}>残業中</span>
                    <div style={{ fontSize: 44, fontWeight: 600, lineHeight: 1.1 }}>
                      <Elapsed since={rec.startedAt.toISOString()} />
                    </div>
                    <div className="small muted">{hmOf(rec.startedAt)} 開始</div>
                    <div className="field" style={{ width: "100%" }}>
                      <label htmlFor={`brk-${r.id}`}>休憩（分）</label>
                      <input id={`brk-${r.id}`} name="breakMinutes" type="number" min={0} max={600} step={5} defaultValue={0} className="input num" />
                    </div>
                    <button type="submit" className="btn dark block" style={{ minHeight: 64, fontSize: 18 }}>
                      <IconStop color="#fff" /> 残業を終了
                    </button>
                  </form>
                )}

                {rec?.endedAt && (
                  <section className="card stack" style={{ alignItems: "center", gap: 6, textAlign: "center" }}>
                    <IconCheck size={32} color="var(--ok)" />
                    <div style={{ fontWeight: 700, fontSize: 17 }}>打刻しました</div>
                    <div className="mono">
                      {hmOf(rec.startedAt)} – {hmOf(rec.endedAt)}
                      {rec.breakMinutes > 0 && `（休憩 ${rec.breakMinutes}分）`}
                    </div>
                    {rec.excessStatus === "PENDING" && <p className="xs muted">予定を超えた分は管理者の承認後に計上されます。</p>}
                  </section>
                )}
              </div>
            );
          })
        )}

        <section className="card stack">
          <div className="between">
            <h2 className="small muted" style={{ fontWeight: 500 }}>{Number(ym.slice(5))}月の残業（承認済）</h2>
            <div className="mono">
              <span style={{ fontSize: 22, fontWeight: 600 }}>{fmtMinutes(month.totals.statutoryMinutes)}</span>
              <span className="small muted"> / {fmtMinutes(settings.limitMonthMinutes)}</span>
            </div>
          </div>
          <div className={`bar ${pct >= settings.warnPercent ? "warn" : ""}`} role="img" aria-label={`36協定の月上限に対して${pct}%`}>
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="between small muted">
            <span>
              概算残業代 <strong className="mono" style={{ color: "var(--ink)" }}>{month.amount === null ? "給与未登録" : fmtYen(month.amount)}</strong>
            </span>
            <span>{fmtDateShort(payday).replace(/^(\d+)\/(\d+)/, "$1月$2日")} 支払</span>
          </div>
          {pct >= settings.warnPercent && <p className="note warn">36協定の上限の{settings.warnPercent}%を超えています。上長に相談してください。</p>}
        </section>
      </main>
    </>
  );
}
