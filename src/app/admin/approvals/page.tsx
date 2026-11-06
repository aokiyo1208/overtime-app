import { activeTimeRecord } from "@/lib/time-record";
import { asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { snapshotMatches } from "@/lib/correction-validation";
import { CorrectionDiff, correctionDateTime } from "@/components/correction-summary";
import { CorrectionSubmitButton } from "@/components/correction-form";
import { approveCorrection, rejectCorrection } from "@/app/(member)/corrections/actions";
import * as t from "@/db/schema";
import { dayTypeOf, DAY_TYPE_LABEL, getHolidayMap, percentOfLimit, projectedMonth } from "@/lib/payroll";
import { fmtDateShort, fmtMinutes, hmOf, ymOf } from "@/lib/time";
import { excessMinutes } from "@/lib/overtime";
import { Flash, one, type SP } from "@/components/flash";
import { approveRequest, bulkApprove, decideExcess, rejectRequest } from "../actions";

import { BackLink } from "@/components/back-link";

export const metadata = { title: "承認待ち" };

export default async function ApprovalsPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
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
  ).filter((r) => activeTimeRecord(r) && r.endedAt);

  const settings = await db.query.settings.findFirst({ where: eq(t.settings.id, 1) });
  const holidayFrom = pending.map((r) => r.workDate).sort()[0] ?? "2026-01-01";
  const holidays = await getHolidayMap(holidayFrom, "2100-01-01");

  const rows = [];
  for (const r of pending) {
    const { totals, settings: s } = await projectedMonth(r.employeeId, ymOf(r.workDate));
    const total = totals.statutoryMinutes;
    rows.push({ r, total, pct: percentOfLimit(total, s.limitMonthMinutes), limit: s.limitMonthMinutes, warnPercent: s.warnPercent });
  }
  const corrections = await db.query.timeCorrectionRequests.findMany({
    where: eq(t.timeCorrectionRequests.status, "PENDING"),
    with: { request: { with: { employee: true, timeRecord: true } } },
    orderBy: asc(t.timeCorrectionRequests.createdAt),
  });
  const closedMonths = new Set((await db.select().from(t.monthlyCloses)).map(row => row.yearMonth));
  const afterCount = pending.filter((r) => r.isAfterTheFact).length;

  return (
    <>
      <BackLink href="/">打刻画面に戻る</BackLink>
      <header className="between" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1>承認待ち</h1>
          <p className="small muted">
            残業申請 {pending.length}件
            {afterCount > 0 && `（事後申請 ${afterCount}件）`}・予定超過 {excess.length}件・打刻修正 {corrections.length}件
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

      <section className="stack" style={{ gap: 12 }} id="time-corrections">
        <div className="stack" style={{ gap: 4 }}>
          <div className="row"><h2>打刻修正の承認</h2><span className="chip wait">{corrections.length}件</span></div>
          <p className="small muted">変更前と申請内容を確認し、日時修正は打刻に反映し、開始打刻の取り消しは未打刻に戻します。残業申請自体の承認とは別の操作です。</p>
        </div>
        {corrections.length === 0 && <p className="card muted">承認待ちの打刻修正はありません。</p>}
        {corrections.map(item => {
          const req = item.request;
          const isStartCancellation = item.kind === "VOID_START";
          const closed = closedMonths.has(ymOf(req.workDate));
          const current = activeTimeRecord(req.timeRecord);
          const stale = !snapshotMatches(item, current);
          const eligible = req.status === "PENDING" || req.status === "APPROVED";
          return <article key={item.id} className="card stack correction-review" style={{ gap: 16 }}>
            <div className="between" style={{ flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 12 }}><strong>{req.employee.name}</strong><span className="small">{fmtDateShort(req.workDate)}</span><span className="chip wait">{isStartCancellation ? "開始取消の承認待ち" : "修正承認待ち"}</span></div>
              <span className="xs muted">申請 {correctionDateTime(item.createdAt)}</span>
            </div>
            <div className="correction-review-body">
              <CorrectionDiff correction={item} />
              <div className="stack" style={{ gap: 10 }}>
                <div><div className="xs muted">{isStartCancellation ? "開始打刻を取り消す理由" : "修正の理由"}</div><p className="small correction-reason">{item.reason}</p></div>
                <div><div className="xs muted">対象の残業申請</div><p className="small correction-reason">{req.task}</p><p className="xs muted">予定 {correctionDateTime(req.plannedStart)} → {correctionDateTime(req.plannedEnd)}</p></div>
                {req.status === "PENDING" && <p className="note warn">残業自体は未承認です。打刻修正を承認しても、残業の承認は完了しません。</p>}
              </div>
            </div>
            {closed && <p className="note warn">対象月は確定済みです。承認・却下できません。</p>}
            {!eligible && <p className="note warn">残業申請が却下・取り消し済みのため反映できません。</p>}
            {stale && <p className="note warn">申請後に打刻が変更されています。この申請は承認できません。内容を確認し、再申請を依頼してください。</p>}
            <div className="row correction-review-actions" style={{ gap: 12, alignItems: "flex-start" }}>
              <form action={approveCorrection}><input type="hidden" name="correctionId" value={item.id} /><CorrectionSubmitButton disabled={closed || stale || !eligible} pendingLabel="反映中…">{isStartCancellation ? "承認して開始打刻を取り消す" : "承認して反映"}</CorrectionSubmitButton></form>
              <details>
                <summary className="btn danger" style={{ listStyle: "none" }}>理由を添えて却下</summary>
                <form action={rejectCorrection} className="stack" style={{ marginTop: 12, maxWidth: 440 }}>
                  <input type="hidden" name="correctionId" value={item.id} />
                  <div className="field"><label htmlFor={`correction-reject-${item.id}`}>却下理由 <span className="req">必須</span></label><textarea id={`correction-reject-${item.id}`} name="comment" className="textarea" rows={3} maxLength={500} placeholder="本人が再申請できるよう、確認が必要な内容を記入してください。" required /></div>
                  <CorrectionSubmitButton className="btn danger" disabled={closed} pendingLabel="却下中…">この理由で却下する</CorrectionSubmitButton>
                </form>
              </details>
              <a href={`/admin/employees/${req.employeeId}?m=${ymOf(req.workDate)}`} className="btn">社員の履歴を見る</a>
            </div>
          </article>;
        })}
      </section>

      <CorrectionRequests />
    </>
  );
}

/** 社員からの打刻修正の依頼 */
async function CorrectionRequests() {
  const all = await db.query.timeRecords.findMany({
    where: isNotNull(t.timeRecords.correctionRequest),
    with: { request: { with: { employee: true } } },
  });
  const list = all.filter((r) => activeTimeRecord(r) && r.correctionRequest);
  if (list.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2>以前の打刻修正依頼（未対応）</h2>
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
