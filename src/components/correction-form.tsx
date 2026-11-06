"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { fmtMinutes, jstDateTime } from "@/lib/time";

export function CorrectionSubmitButton({ children, pendingLabel = "処理中…", className = "btn primary", disabled = false }: {
  children: React.ReactNode; pendingLabel?: string; className?: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending || disabled} aria-disabled={pending || disabled}>{pending ? pendingLabel : children}</button>;
}
export function CorrectionForm({ requestId, workDate, initialStart, initialEnd, initialEndDate, initialBreakMinutes, action }: {
  requestId: string; workDate: string; initialStart: string; initialEnd: string; initialEndDate: string; initialBreakMinutes: number;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const startDate = workDate;
  const [endDate, setEndDate] = useState(initialEndDate);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [breakMinutes, setBreakMinutes] = useState(String(initialBreakMinutes));
  const [reason, setReason] = useState("");
  const duration = startDate && endDate && start && end ? (jstDateTime(endDate, end).getTime() - jstDateTime(startDate, start).getTime()) / 60000 : null;
  const breakValue = Number(breakMinutes);
  const invalid = duration !== null && (duration <= 0 || duration > 960 || breakValue >= duration);
  return <form action={action} className="card stack" style={{ gap: 18 }}>
    <input type="hidden" name="requestId" value={requestId} />
    <div className="stack" style={{ gap: 4 }}><h2 style={{ fontSize: 16 }}>正しい打刻を入力</h2><p className="xs muted">残業が終了してから、実際の開始・終了を入力してください。未打刻の時刻は空欄です。</p></div>
    <fieldset className="correction-fieldset"><legend>開始 <span className="req">必須</span></legend>
      <div className="correction-date-fields">
        <div className="field"><label htmlFor="correction-start-date">開始日</label><input id="correction-start-date" type="date" name="startDate" className="input" value={startDate} readOnly required aria-describedby="correction-date-help" /></div>
        <div className="field"><label htmlFor="correction-start">開始時刻</label><input id="correction-start" type="time" name="start" className="input mono" value={start} onChange={e => setStart(e.target.value)} required /></div>
      </div><p id="correction-date-help" className="xs muted">開始日は残業申請の対象日です。</p>
    </fieldset>
    <fieldset className="correction-fieldset"><legend>終了 <span className="req">必須</span></legend>
      <div className="correction-date-fields">
        <div className="field"><label htmlFor="correction-end-date">終了日</label><input id="correction-end-date" type="date" name="endDate" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} required /></div>
        <div className="field"><label htmlFor="correction-end">終了時刻</label><input id="correction-end" type="time" name="end" className="input mono" value={end} onChange={e => setEnd(e.target.value)} required /></div>
      </div><p className="xs muted">日をまたいだ場合は、終了日を翌日にしてください。</p>
    </fieldset>
    <div className="field"><label htmlFor="correction-break">休憩（分） <span className="req">必須</span></label><input id="correction-break" type="number" name="breakMinutes" className="input num" min={0} max={600} step={1} value={breakMinutes} onChange={e => setBreakMinutes(e.target.value)} required /></div>
    <div className={`note ${invalid ? "bad" : ""}`} aria-live="polite">{duration === null ? "開始と終了を入力すると、休憩を除いた時間を確認できます。" : invalid ? "終了は開始より後、16時間以内にしてください。休憩は打刻の時間より短くしてください。" : <div className="between"><span>修正後の打刻時間（休憩除く）</span><strong className="mono">{fmtMinutes(duration - breakValue)}</strong></div>}</div>
    <div className="field"><label htmlFor="correction-reason">修正の理由 <span className="req">必須</span></label><textarea id="correction-reason" name="reason" className="textarea" rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="例：現場対応後に終了の打刻を忘れたため。実際は21:15に終了しました。" required /><span className="xs muted" style={{ textAlign: "right" }}>{reason.length} / 500文字</span></div>
    <p className="xs muted">送信後は管理者の承認待ちになります。承認されるまで現在の打刻は変わりません。</p>
    <CorrectionSubmitButton className="btn primary block" pendingLabel="申請を送信中…" disabled={invalid || !reason.trim()}>この内容で修正を申請</CorrectionSubmitButton>
  </form>;
}


export function StartCancellationForm({ requestId, action }: {
  requestId: string; action: (fd: FormData) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return <section className="card stack" style={{ border: "1px solid var(--line)" }}>
    <div className="stack" style={{ gap: 4 }}>
      <h2 style={{ fontSize: 16 }}>開始を誤って押したとき</h2>
      <p className="small muted">残業をしていないのに開始した場合は、開始打刻だけの取り消しを申請できます。終了時刻の入力は不要です。</p>
    </div>
    <details>
      <summary className="btn" style={{ listStyle: "none" }}>開始打刻の取り消しを申請</summary>
      <form action={action} className="stack" style={{ marginTop: 16 }}>
        <input type="hidden" name="requestId" value={requestId} />
        <div className="field">
          <label htmlFor="start-cancellation-reason">取り消しの理由 <span className="req">必須</span></label>
          <textarea id="start-cancellation-reason" name="reason" className="textarea" rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="例：残業開始前に誤って開始ボタンを押したため。まだ残業はしていません。" required />
          <span className="xs muted" style={{ textAlign: "right" }}>{reason.length} / 500文字</span>
        </div>
        <p className="note">管理者が承認すると未打刻に戻ります。承認までは現在の開始打刻が残ります。残業申請自体は取り消されません。</p>
        <CorrectionSubmitButton className="btn primary block" pendingLabel="申請を送信中…" disabled={!reason.trim()}>開始打刻の取り消しを申請する</CorrectionSubmitButton>
      </form>
    </details>
  </section>;
}
