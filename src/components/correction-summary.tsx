import { hmOf, ymdOf } from "@/lib/time";

export const CORRECTION_STATUS = {
  PENDING: { label: "修正承認待ち", cls: "wait" },
  APPROVED: { label: "承認・反映済", cls: "ok" },
  REJECTED: { label: "却下", cls: "bad" },
  CANCELED: { label: "申請取り消し済", cls: "off" },
} as const;

export function correctionDateTime(value: Date | null) {
  return value ? `${ymdOf(value).replaceAll("-", "/")} ${hmOf(value)}` : "未打刻";
}
export type CorrectionSnapshot = {
  originalStartedAt: Date | null; originalEndedAt: Date | null; originalBreakMinutes: number | null;
  proposedStartedAt: Date | null; proposedEndedAt: Date | null; proposedBreakMinutes: number | null;
  kind?: "CORRECT" | "VOID_START";
};
export function CorrectionDiff({ correction }: { correction: CorrectionSnapshot }) {
  const rows = correction.kind === "VOID_START" ? [
    ["開始", correctionDateTime(correction.originalStartedAt), "未打刻"],
  ] : [
    ["開始", correctionDateTime(correction.originalStartedAt), correctionDateTime(correction.proposedStartedAt)],
    ["終了", correctionDateTime(correction.originalEndedAt), correctionDateTime(correction.proposedEndedAt)],
    ["休憩", correction.originalBreakMinutes === null ? "記録なし" : `${correction.originalBreakMinutes}分`, correction.proposedBreakMinutes === null ? "記録なし" : `${correction.proposedBreakMinutes}分`],
  ];
  return <div className="correction-diff">
    <div className="correction-diff-head xs muted"><span>項目</span><span>変更前</span><span>申請内容</span></div>
    {rows.map(([label, before, after]) => <div className="correction-diff-row" key={label}>
      <span className="xs muted">{label}</span><span className="mono small">{before}</span>
      <strong className={`mono small ${before !== after ? "correction-changed" : ""}`}>{after}</strong>
    </div>)}
    {correction.kind === "VOID_START" && <p className="small muted" style={{ marginTop: 8 }}>開始打刻を取り消して未打刻に戻します。終了時刻は登録しません。</p>}
    <p className="xs muted" style={{ marginTop: 8 }}>日時はすべて日本時間（JST）</p>
  </div>;
}
export type CorrectionHistoryItem = CorrectionSnapshot & {
  id: string; status: keyof typeof CORRECTION_STATUS; reason: string; createdAt: Date;
  decidedAt: Date | null; rejectComment: string | null; reviewer?: { name: string } | null;
};
export function CorrectionHistory({ items }: { items: CorrectionHistoryItem[] }) {
  return <section className="stack" style={{ gap: 10 }}>
    <h2 style={{ fontSize: 16 }}>打刻修正の履歴</h2>
    {items.length === 0 ? <p className="card small muted">まだ修正申請はありません。</p> : items.map(item => {
      const status = CORRECTION_STATUS[item.status];
      return <article className="card stack" key={item.id}>
        <div className="between" style={{ flexWrap: "wrap" }}><span className={`chip ${status.cls}`}>{status.label}</span><span className="xs muted">申請 {correctionDateTime(item.createdAt)}</span></div>
        <div className="small" style={{ fontWeight: 700 }}>{item.kind === "VOID_START" ? "開始打刻の取り消し" : "打刻日時の修正"}</div>
        <CorrectionDiff correction={item} />
        <div className="small"><span className="xs muted">申請理由</span><p className="correction-reason">{item.reason}</p></div>
        {item.rejectComment && <p className="note bad correction-reason">却下理由：{item.rejectComment}</p>}
        {item.decidedAt && <p className="xs muted">{item.status === "CANCELED" ? "申請を取り消し" : `${item.reviewer?.name ?? "管理者"} が判断`} · {correctionDateTime(item.decidedAt)}</p>}
      </article>;
    })}
  </section>;
}
