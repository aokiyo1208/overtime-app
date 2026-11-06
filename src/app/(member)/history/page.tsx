import { activeTimeRecord } from "@/lib/time-record";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { timeCorrectionRequests } from "@/db/schema";
import { CORRECTION_STATUS } from "@/components/correction-summary";
import { requireUser } from "@/lib/session";
import { computeEmployeeMonth, monthRequests } from "@/lib/payroll";
import { currentYm, fmtDateShort, fmtMinutes, fmtYen, fmtYm, hmOf, isValidYm, shiftYm } from "@/lib/time";
import { Flash, one, type SP } from "@/components/flash";
import { IconLeft, IconRight } from "@/components/icons";
import { cancelRequest } from "../actions";

import { BackLink } from "@/components/back-link";

export const metadata = { title: "履歴" };

export default async function HistoryPage({ searchParams }: { searchParams: SP }) {
  const me = await requireUser();
  const sp = await searchParams;
  const m = one(sp.m);
  const ym = isValidYm(m) ? m : currentYm();
  const requests = await monthRequests(me.id, ym);
  const month = await computeEmployeeMonth(me, ym);
  const isCurrent = ym >= currentYm();
  const corrections = requests.length ? await db.query.timeCorrectionRequests.findMany({
    where: and(eq(timeCorrectionRequests.employeeId, me.id), inArray(timeCorrectionRequests.requestId, requests.map(r => r.id))),
    orderBy: desc(timeCorrectionRequests.createdAt),
  }) : [];
  const latestCorrection = new Map<string, (typeof corrections)[number]>();
  for (const item of corrections) if (!latestCorrection.has(item.requestId)) latestCorrection.set(item.requestId, item);

  return (
    <>
      <div style={{ padding: "4px 20px 0" }}><BackLink href="/">打刻に戻る</BackLink></div>
      <header className="m-head" style={{ alignItems: "center" }}>
        <h1>履歴</h1>
        <div className="row" style={{ gap: 0 }}>
          <Link href={`/history?m=${shiftYm(ym, -1)}`} aria-label="前の月" className="btn" style={{ border: "none", background: "none", minWidth: 44 }}>
            <IconLeft />
          </Link>
          <span style={{ fontWeight: 700 }}>{fmtYm(ym)}</span>
          {isCurrent ? (
            <span style={{ width: 44 }} />
          ) : (
            <Link href={`/history?m=${shiftYm(ym, 1)}`} aria-label="次の月" className="btn" style={{ border: "none", background: "none", minWidth: 44 }}>
              <IconRight />
            </Link>
          )}
        </div>
      </header>

      <main className="m-main">
        <Flash msg={one(sp.msg)} err={one(sp.err)} />

        <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", padding: "14px 4px", textAlign: "center" }}>
          <div>
            <div className="xs muted">残業合計</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
              {fmtMinutes(month.totals.statutoryMinutes + month.totals.innerMinutes + month.totals.holidayMinutes)}
            </div>
          </div>
          <div style={{ borderLeft: "1px solid var(--line-2)", borderRight: "1px solid var(--line-2)" }}>
            <div className="xs muted">うち深夜</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtMinutes(month.totals.nightMinutes)}</div>
          </div>
          <div>
            <div className="xs muted">概算残業代</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{month.amount === null ? "—" : fmtYen(month.amount)}</div>
          </div>
        </section>

        {requests.length === 0 && <p className="muted small">この月の申請はありません。</p>}

        <ul className="list">
          {requests.map((r) => {
            const rec = activeTimeRecord(r.timeRecord);
            const correction = latestCorrection.get(r.id);
            const ymd = r.workDate;
            let chip = { cls: "wait", label: "申請中" };
            if (r.status === "APPROVED") chip = { cls: "ok", label: "承認済" };
            if (r.status === "REJECTED") chip = { cls: "bad", label: "却下" };
            if (r.status === "CANCELED") chip = { cls: "off", label: "取消" };
            const worked = rec?.endedAt ? Math.floor((rec.endedAt.getTime() - rec.startedAt.getTime()) / 60000) - rec.breakMinutes : null;
            return (
              <li key={r.id} className="stack" style={{ gap: 6 }}>
                <div style={{ display: "grid", gridTemplateColumns: "84px minmax(0,1fr) auto", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtDateShort(ymd)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="mono small">
                      {rec ? `${hmOf(rec.startedAt)} – ${rec.endedAt ? hmOf(rec.endedAt) : "--:--"}` : `${hmOf(r.plannedStart)} – ${hmOf(r.plannedEnd)}`}
                    </div>
                    <div className="xs muted">
                      {rec ? (worked !== null ? fmtMinutes(worked) : "終了打刻なし") : "予定・打刻前"}
                      {r.isAfterTheFact && "・事後申請"}
                      {rec?.excessStatus === "PENDING" && "・予定超過の承認待ち"}
                    </div>
                  </div>
                  <span className={`chip ${chip.cls}`}>{chip.label}</span>
                </div>
                <div className="xs" style={{ color: "var(--ink-2)" }}>{r.task}</div>
                {r.status === "REJECTED" && r.rejectComment && <div className="xs" style={{ color: "var(--bad)" }}>却下理由：{r.rejectComment}</div>}
                {r.status === "PENDING" && !rec && (
                  <form action={cancelRequest}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="linkbtn small" style={{ minHeight: 32 }}>この申請を取り消す</button>
                  </form>
                )}
                {(r.status === "PENDING" || r.status === "APPROVED" || correction) && (
                  <div className="between" style={{ flexWrap: "wrap", marginTop: 6 }}>
                    <Link href={`/corrections/${r.id}`} className="btn sm">{correction ? "打刻修正・履歴を確認" : "打刻を修正申請"}</Link>
                    {correction && <span className={`chip ${CORRECTION_STATUS[correction.status].cls}`}>{correction.kind === "VOID_START" && "開始取消 · "}{CORRECTION_STATUS[correction.status].label}</span>}
                  </div>
                )}
                {rec?.correctionRequest && <div className="xs muted">以前の修正依頼：{rec.correctionRequest}</div>}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
