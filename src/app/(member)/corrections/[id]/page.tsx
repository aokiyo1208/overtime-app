import { activeTimeRecord } from "@/lib/time-record";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { overtimeRequests, timeCorrectionRequests } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { isMonthClosed } from "@/lib/payroll";
import { fmtDateLong, hmOf, ymOf, ymdOf } from "@/lib/time";
import { BackLink } from "@/components/back-link";
import { Flash, one, type SP } from "@/components/flash";
import { CorrectionForm, CorrectionSubmitButton, StartCancellationForm } from "@/components/correction-form";
import { CorrectionHistory, correctionDateTime } from "@/components/correction-summary";
import { cancelCorrection, submitCorrection, submitStartCancellation } from "../actions";
export const metadata = { title: "打刻修正" };
export default async function CorrectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const request = await db.query.overtimeRequests.findFirst({ where: and(eq(overtimeRequests.id, id), eq(overtimeRequests.employeeId, me.id)), with: { timeRecord: true } });
  if (!request) notFound();
  const [closed, history] = await Promise.all([
    isMonthClosed(ymOf(request.workDate)),
    db.query.timeCorrectionRequests.findMany({ where: and(eq(timeCorrectionRequests.requestId, id), eq(timeCorrectionRequests.employeeId, me.id)), with: { reviewer: true }, orderBy: desc(timeCorrectionRequests.createdAt) }),
  ]);
  const pending = history.find(item => item.status === "PENDING");
  const rec = activeTimeRecord(request.timeRecord);
  const eligible = request.status === "PENDING" || request.status === "APPROVED";
  return <>
    <header className="m-head" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}><BackLink href={`/history?m=${ymOf(request.workDate)}`}>履歴に戻る</BackLink><h1>打刻修正</h1><p className="small muted">開始・終了の打刻忘れ、時刻の間違い、誤った開始に</p></header>
    <main className="m-main">
      <Flash msg={one(sp.msg)} err={one(sp.err)} />
      <section className="card stack">
        <div className="between" style={{ flexWrap: "wrap" }}><h2 style={{ fontSize: 16 }}>{fmtDateLong(request.workDate)}</h2><span className={`chip ${request.status === "APPROVED" ? "ok" : "off"}`}>残業 {request.status === "APPROVED" ? "承認済" : request.status === "PENDING" ? "申請中" : request.status === "REJECTED" ? "却下" : "取消"}</span></div>
        <p className="small correction-reason">{request.task}</p><div className="xs muted">予定 {correctionDateTime(request.plannedStart)} → {correctionDateTime(request.plannedEnd)}</div>
        <div className="correction-current stack" style={{ gap: 6 }}><h3 className="xs muted">現在の打刻</h3>
          <div className="between small"><span>開始</span><span className="mono">{correctionDateTime(rec?.startedAt ?? null)}</span></div>
          <div className="between small"><span>終了</span><span className="mono">{correctionDateTime(rec?.endedAt ?? null)}</span></div>
          <div className="between small"><span>休憩</span><span className="mono">{rec ? `${rec.breakMinutes}分` : "記録なし"}</span></div>
        </div>
        {rec?.correctionRequest && <p className="note warn correction-reason">以前の修正依頼：{rec.correctionRequest}<br /><span className="xs">管理者が対応状況を確認できます。</span></p>}
      </section>
      <p className="note">打刻修正と残業自体の承認は別です。承認後、日時の修正は申請した日時・休憩が反映され、開始打刻の取り消しは未打刻に戻ります。通常勤務の出退勤は変更されません。</p>
      {closed ? <p className="note warn">この月は確定済みのため、修正を申請・取り消しできません。管理者にご相談ください。</p> : !eligible ? <p className="note warn">却下・取り消し済みの残業申請は修正できません。</p> : pending ? <section className="card stack" style={{ border: "1px solid var(--accent-tint)" }}>
        <div className="between" style={{ flexWrap: "wrap" }}><h2 style={{ fontSize: 16 }}>管理者の承認待ちです</h2><span className="chip wait">{pending.kind === "VOID_START" ? "開始取消の承認待ち" : "修正承認待ち"}</span></div>
        <p className="small muted">申請内容は下の履歴で確認できます。内容を変える場合は、取り消してから再申請してください。</p>
        <form action={cancelCorrection}><input type="hidden" name="correctionId" value={pending.id} /><CorrectionSubmitButton className="btn sm" pendingLabel="取り消し中…">この申請を取り消す</CorrectionSubmitButton></form>
      </section> : rec?.correctionRequest ? <p className="note warn">以前の修正依頼が対応待ちです。管理者の対応が完了してから、新しい修正申請ができます。</p> : <>
        {rec && !rec.endedAt && <StartCancellationForm requestId={id} action={submitStartCancellation} />}
        <CorrectionForm requestId={id} workDate={request.workDate} initialStart={rec ? hmOf(rec.startedAt) : ""} initialEnd={rec?.endedAt ? hmOf(rec.endedAt) : ""} initialEndDate={rec?.endedAt ? ymdOf(rec.endedAt) : ymdOf(request.plannedEnd)} initialBreakMinutes={rec?.breakMinutes ?? 0} action={submitCorrection} />
      </>}
      <CorrectionHistory items={history} />
    </main>
  </>;
}
