import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as t from "@/db/schema";
import { dayTypeOf, DAY_TYPE_LABEL, getHolidayMap, percentOfLimit, projectedMonth } from "@/lib/payroll";
import { fmtDateShort, fmtMinutes, hmOf, ymOf } from "@/lib/time";
import { excessMinutes } from "@/lib/overtime";
import { Flash, one, type SP } from "@/components/flash";
import { approveRequest, bulkApprove, decideExcess, rejectRequest } from "../actions";

import { BackLink } from "@/components/back-link";

export const metadata = { title: "承認待ち" };

export default async function ApprovalsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const pending = await db.query.overtimeRequests.findMany({
    where: eq(t.overtimeRequests.status, "PENDING"),
    with: { employee: true },
    orderBy: [asc(t.overtimeRequests.workDate), asc(t.overtimeRequests.plannedStart)],
  });
  const excess = (
    await db.query.timeRecords.findMany({
      where: eq(t.timeRecords.excessStatus, "PENDING"),
      with: { request: { with: { employee: true } } },
    })
  ).filter((r) => r.endedAt);

  const settings = await db.query.settings.findFirst({ where: eq(t.settings.id, 1) });
  const holidayFrom = pending.map((r) => r.workDate).sort()[0] ?? "2026-01-01";
  const holidays = await getHolidayMap(holidayFrom, "2100-01-01");

  const rows = [];
  for (const r of pending) {
    const { totals, settings: s } = await projectedMonth(r.employeeId, ymOf(r.workDate));
    const total = totals.statutoryMinutes;
    rows.push({ r, total, pct: percentOfLimit(total, s.limitMonthMinutes), limit: s.limitMonthMinutes, warnPercent: s.warnPercent });
  }
  const afterCount = pending.filter((r) => r.isAfterTheFact).length;

  return (
    <>
      <BackLink href="/">打刻画面に戻る</BackLink>
      <header className="between" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>承認待ち</h1>
          <p className="small muted">
            残業申請 {pending.length}件
            {afterCount > 0 && `（事後申請 ${afterCount}件）`}・予定超過 {excess.length}件
          </p>
        </div>
        <button type="submit" form="bulk" className="btn primary" disabled={pending.length === 0}>選択した申請を承認</button>
      </header>

      <Flash msg={one(sp.msg)} err={one(sp.err)} />

      <section className="stack" style={{ gap: 10 }}>
        <h2>残業申請</h2>
        <form id="bulk" action={bulkApprove} />
        {pending.length === 0 ? (
          <p className="card muted">承認待ちの申請はありません。</p>
        ) : (
          <div className="tablewrap">
            <table className="tb" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th><span className="sr-only" style={{ position: "absolute", left: -9999 }}>選択</span></th>
                  <th>社員</th>
                  <th>対象日</th>
                  <th>予定</th>
                  <th>業務内容・理由</th>
                  <th>承認後の当月見込み（上限 {fmtMinutes(rows[0]?.limit ?? 2700)}）</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, total, pct, limit, warnPercent }) => {
                  const dt = settings ? dayTypeOf(r.workDate, settings, holidays) : "workday";
                  const warn = pct >= warnPercent;
                  return (
                    <tr key={r.id}>
                      <td>
                        <input type="checkbox" name="ids" value={r.id} form="bulk" aria-label={`${r.employee.name}の申請を選択`} />
                      </td>
                      <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{r.employee.name}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {fmtDateShort(r.workDate)}
                        <div className="row" style={{ gap: 4, marginTop: 4 }}>
                          {r.isAfterTheFact && <span className="chip bad">事後申請</span>}
                          {dt !== "workday" && <span className="chip wait">{DAY_TYPE_LABEL[dt]}</span>}
                        </div>
                      </td>
                      <td className="mono" style={{ whiteSpace: "nowrap" }}>
                        {hmOf(r.plannedStart)}–{hmOf(r.plannedEnd)}
                        <div className="xs muted">{fmtMinutes(Math.round((r.plannedEnd.getTime() - r.plannedStart.getTime()) / 60000))}</div>
                      </td>
                      <td style={{ minWidth: 220 }}>
                        {r.task}
                        <div className="small muted">{r.reason}</div>
                      </td>
                      <td style={{ minWidth: 190 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="mono" style={{ fontWeight: 600 }}>{fmtMinutes(total)}</span>
                          <span className={warn ? "chip warn" : "xs muted"}>{pct}%{warn && " 上限接近"}</span>
                        </div>
                        <div className={`bar sm ${warn ? "warn" : ""}`} style={{ marginTop: 6 }} role="img" aria-label={`上限の${pct}%`}>
                          <span style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                        <span className="sr-only" style={{ display: "none" }}>{limit}</span>
                      </td>
                      <td style={{ minWidth: 190 }}>
                        <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
                          <form action={approveRequest}>
                            <input type="hidden" name="id" value={r.id} />
                            <button type="submit" className="btn primary sm">承認</button>
                          </form>
                          <details>
                            <summary className="btn sm" style={{ listStyle: "none" }}>却下</summary>
                            <form action={rejectRequest} className="stack" style={{ marginTop: 8, minWidth: 220 }}>
                              <input type="hidden" name="id" value={r.id} />
                              <label htmlFor={`rej-${r.id}`} className="xs label">却下の理由（本人に通知されます）</label>
                              <input id={`rej-${r.id}`} name="comment" className="input" style={{ minHeight: 38, fontSize: 14 }} required />
                              <button type="submit" className="btn sm danger">却下する</button>
                            </form>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <div className="stack" style={{ gap: 2 }}>
          <h2>予定超過</h2>
          <p className="small muted">承認した予定を超えて打刻された時間です。承認すると実績に計上されます。</p>
        </div>
        {excess.length === 0 ? (
          <p className="card muted">予定を超えた打刻はありません。</p>
        ) : (
          excess.map((rec) => {
            const req = rec.request;
            const over = excessMinutes({ start: req.plannedStart, end: req.plannedEnd }, { start: rec.startedAt, end: rec.endedAt! });
            return (
              <div key={rec.id} className="card row" style={{ gap: "16px 32px" }}>
                <strong style={{ minWidth: 90 }}>{req.employee.name}</strong>
                <div>
                  <div className="xs muted">{fmtDateShort(req.workDate)} 予定</div>
                  <div className="mono">{hmOf(req.plannedStart)}–{hmOf(req.plannedEnd)}</div>
                </div>
                <div>
                  <div className="xs muted">打刻</div>
                  <div className="mono">{hmOf(rec.startedAt)}–{hmOf(rec.endedAt!)}</div>
                </div>
                <div>
                  <div className="xs muted">超過</div>
                  <div className="mono" style={{ fontWeight: 600, color: "var(--warn)" }}>+{fmtMinutes(over)}</div>
                </div>
                <div className="small" style={{ flex: "1 1 200px", color: "var(--ink-2)" }}>{req.task}</div>
                <form action={decideExcess} className="row" style={{ gap: 6 }}>
                  <input type="hidden" name="recordId" value={rec.id} />
                  <button type="submit" name="approve" value="1" className="btn primary sm">超過分を承認</button>
                  <button type="submit" name="approve" value="0" className="btn sm">計上しない</button>
                </form>
              </div>
            );
          })
        )}
      </section>

      <CorrectionRequests />
    </>
  );
}

/** 社員からの打刻修正の依頼 */
async function CorrectionRequests() {
  const all = await db.query.timeRecords.findMany({
    where: and(eq(t.timeRecords.corrected, false)),
    with: { request: { with: { employee: true } } },
  });
  const list = all.filter((r) => r.correctionRequest);
  if (list.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2>打刻の修正依頼</h2>
        <p className="small muted">社員別詳細の「打刻を修正」から時刻を直してください。</p>
      </div>
      {list.map((rec) => (
        <div key={rec.id} className="card row" style={{ gap: "8px 24px" }}>
          <strong style={{ minWidth: 90 }}>{rec.request.employee.name}</strong>
          <span className="small">{fmtDateShort(rec.request.workDate)}</span>
          <span className="small" style={{ flex: "1 1 240px" }}>{rec.correctionRequest}</span>
          <a className="btn sm" href={`/admin/employees/${rec.request.employeeId}?m=${ymOf(rec.request.workDate)}`}>修正する</a>
        </div>
      ))}
    </section>
  );
}
