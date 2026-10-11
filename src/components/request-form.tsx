"use client";

import { useState } from "react";

function minutesBetween(start: string, end: string): number {
  if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end)) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let d = eh * 60 + em - (sh * 60 + sm);
  if (d <= 0) d += 24 * 60;
  return d;
}
const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export function RequestForm({
  action,
  today,
  currentYm,
  projectedMinutes,
  limitMinutes,
  warnPercent,
}: {
  action: (fd: FormData) => void | Promise<void>;
  today: string;
  currentYm: string;
  projectedMinutes: number;
  limitMinutes: number;
  warnPercent: number;
}) {
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const dur = minutesBetween(start, end);
  const sameMonth = date.slice(0, 7) === currentYm;
  const after = projectedMinutes + dur;
  const pct = limitMinutes > 0 ? Math.round((after / limitMinutes) * 100) : 0;
  const warn = pct >= warnPercent;

  return (
    <form action={action} className="stack" style={{ gap: 16 }}>
      <div className="field">
        <label htmlFor="workDate">対象日</label>
        <input id="workDate" name="workDate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="start">予定開始</label>
          <input id="start" name="start" type="time" step={300} className="input mono" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="end">予定終了</label>
          <input id="end" name="end" type="time" step={300} className="input mono" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
      </div>
      <p className="xs muted" style={{ marginTop: -8 }}>予定 {fmt(dur)}（終了が開始より前なら翌日まで）</p>
      <div className="field">
        <label htmlFor="task">業務内容 <span className="req">必須</span></label>
        <textarea id="task" name="task" rows={2} maxLength={200} className="textarea" placeholder="例：施工計画書の作成（△△ビル 外壁改修）" required />
      </div>
      <div className="field">
        <label htmlFor="reason">理由 <span className="req">必須</span></label>
        <textarea id="reason" name="reason" rows={3} maxLength={500} className="textarea" placeholder="例：翌日の発注者協議に提出するため" required />
      </div>

      {sameMonth && (
        <div className={`note ${warn ? "warn" : ""} stack`} style={{ gap: 8 }}>
          <div className="between">
            <span>申請後の{Number(currentYm.slice(5))}月見込み</span>
            <span className="mono">
              <strong style={{ fontSize: 16 }}>{fmt(after)}</strong> / {fmt(limitMinutes)}
            </span>
          </div>
          <div className={`bar sm ${warn ? "warn" : ""}`} role="img" aria-label={`36協定の月上限に対して${pct}%`}>
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <span className="xs">
            {warn
              ? `36協定の上限の${warnPercent}%を超える見込みです。申請はできますが、上長に相談してください。`
              : `36協定の上限内です。上限の${warnPercent}%を超える申請には警告が出ます。`}
          </span>
        </div>
      )}

      <button type="submit" className="btn primary block">申請する</button>
    </form>
  );
}
