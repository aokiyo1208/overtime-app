import Link from "next/link";
import { getHolidayMap, getSettings, monthSummaries, percentOfLimit } from "@/lib/payroll";
import { currentYm, fmtDateShort, fmtMinutes, fmtYen, fmtYm, isValidYm, monthBounds, paydayOf, shiftYm } from "@/lib/time";
import { Flash, one, type SP } from "@/components/flash";
import { IconDownload, IconLeft, IconRight } from "@/components/icons";
import { closeMonth, reopenMonth } from "../actions";

export const metadata = { title: "月次集計" };

const z = (n: number) => (n === 0 ? "zero" : "");

export default async function MonthlyPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const m = one(sp.m);
  const ym = isValidYm(m) ? m : shiftYm(currentYm(), -1);
  const settings = await getSettings();
  const { closed, rows } = await monthSummaries(ym);
  const next = monthBounds(shiftYm(ym, 1));
  const holidays = await getHolidayMap(next.first, next.last);
  const payday = paydayOf(ym, new Set(holidays.keys()));

  const sum = rows.reduce(
    (a, r) => ({
      stat: a.stat + r.totals.statutoryMinutes,
      inner: a.inner + r.totals.innerMinutes,
      night: a.night + r.totals.nightMinutes,
      hol: a.hol + r.totals.holidayMinutes,
      o60: a.o60 + r.totals.over60Minutes,
      amount: a.amount + (r.amount ?? 0),
    }),
    { stat: 0, inner: 0, night: 0, hol: 0, o60: 0, amount: 0 },
  );
  const nearLimit = rows.filter((r) => percentOfLimit(r.totals.statutoryMinutes, settings.limitMonthMinutes) >= settings.warnPercent).length;
  // 残業があるのに給与マスタが未登録の社員だけを警告する（残業のない管理者などは対象外）
  const missingSalary = rows.filter((r) => r.amount === null && r.totals.innerMinutes + r.totals.statutoryMinutes + r.totals.holidayMinutes > 0).length;
  const isFuture = ym > currentYm();

  return (
    <>
      <header className="between" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8 }}>
          <Link href={`/admin/monthly?m=${shiftYm(ym, -1)}`} className="btn" aria-label="前の月" style={{ minWidth: 40, padding: 0 }}><IconLeft size={18} /></Link>
          <h1>{fmtYm(ym)}分</h1>
          <Link href={`/admin/monthly?m=${shiftYm(ym, 1)}`} className="btn" aria-label="次の月" style={{ minWidth: 40, padding: 0 }}><IconRight size={18} /></Link>
          <span className={`chip ${closed ? "ok" : "warn"}`}>{closed ? "確定済" : "確定前"}</span>
        </div>
        <div className="row">
          {closed ? (
            <form action={reopenMonth}>
              <input type="hidden" name="ym" value={ym} />
              <button type="submit" className="btn">確定を解除</button>
            </form>
          ) : (
            <form action={closeMonth}>
              <input type="hidden" name="ym" value={ym} />
              <button type="submit" className="btn dark" disabled={isFuture}>この月を確定する</button>
            </form>
          )}
          <a className="btn primary" href={`/admin/monthly/csv?m=${ym}`}><IconDownload size={16} color="#fff" /> CSV出力</a>
        </div>
      </header>

      <Flash msg={one(sp.msg)} err={one(sp.err)} />
      {!closed && <p className="note">確定前の金額は、現在の給与マスタと打刻から計算した見込みです。確定すると金額が固定され、申請・打刻・承認がロックされます。</p>}
      {missingSalary > 0 && <p className="note warn">給与マスタが未登録の社員が{missingSalary}名います。金額は「—」で表示されます。</p>}

      <section className="grid3">
        <div className="stat"><span className="xs muted">残業代合計（{rows.length}名）</span><span className="v">{fmtYen(sum.amount)}</span></div>
        <div className="stat"><span className="xs muted">時間外労働の合計</span><span className="v">{fmtMinutes(sum.stat)}</span></div>
        <div className="stat">
          <span className="xs muted">36協定 {settings.warnPercent}%超</span>
          <span className="v" style={{ color: nearLimit ? "var(--warn)" : undefined }}>{nearLimit}名</span>
        </div>
        <div className="stat">
          <span className="xs muted">支払日</span>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{fmtDateShort(payday).replace(/^(\d+)\/(\d+)/, "$1月$2日")}</span>
          <span className="xs muted">翌月25日（土日・休日なら前営業日）</span>
        </div>
      </section>

      <section className="tablewrap">
        <table className="tb" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>社員</th>
              <th className="r" style={{ textAlign: "right" }}>法定内</th>
              <th style={{ textAlign: "right" }}>時間外</th>
              <th style={{ textAlign: "right" }}>うち深夜</th>
              <th style={{ textAlign: "right" }}>法定休日</th>
              <th style={{ textAlign: "right" }}>60時間超</th>
              <th style={{ textAlign: "right" }}>36協定（月{fmtMinutes(settings.limitMonthMinutes)}）</th>
              <th style={{ textAlign: "right" }}>時間単価</th>
              <th style={{ textAlign: "right" }}>残業代</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="muted">この月のデータはありません。</td></tr>
            )}
            {rows.map((r) => {
              const pct = percentOfLimit(r.totals.statutoryMinutes, settings.limitMonthMinutes);
              const warn = pct >= settings.warnPercent;
              return (
                <tr key={r.employee.id}>
                  <td>
                    <Link href={`/admin/employees/${r.employee.id}?m=${ym}&from=monthly`} style={{ color: "var(--ink)", fontWeight: 700 }}>{r.employee.name}</Link>
                    {r.payType === "HOURLY" && <span className="xs muted"> 時給</span>}
                  </td>
                  <td className={`r ${z(r.totals.innerMinutes)}`}>{fmtMinutes(r.totals.innerMinutes)}</td>
                  <td className="r">{fmtMinutes(r.totals.statutoryMinutes)}</td>
                  <td className={`r ${z(r.totals.nightMinutes)}`}>{fmtMinutes(r.totals.nightMinutes)}</td>
                  <td className={`r ${z(r.totals.holidayMinutes)}`}>{fmtMinutes(r.totals.holidayMinutes)}</td>
                  <td className={`r ${z(r.totals.over60Minutes)}`}>{fmtMinutes(r.totals.over60Minutes)}</td>
                  <td className="r">
                    <span className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "nowrap" }}>
                      <span style={{ fontWeight: warn ? 600 : 400, color: warn ? "var(--warn)" : undefined }}>{pct}%</span>
                      <span className={`bar sm ${warn ? "warn" : ""}`} style={{ width: 80 }} role="img" aria-label={`上限の${pct}%`}>
                        <span style={{ width: `${Math.min(100, pct)}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="r">{r.hourlyRate === null ? "—" : fmtYen(r.hourlyRate)}</td>
                  <td className="r" style={{ fontWeight: 600 }}>{r.amount === null ? "—" : fmtYen(r.amount)}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td>合計</td>
                <td className="r">{fmtMinutes(sum.inner)}</td>
                <td className="r">{fmtMinutes(sum.stat)}</td>
                <td className="r">{fmtMinutes(sum.night)}</td>
                <td className="r">{fmtMinutes(sum.hol)}</td>
                <td className="r">{fmtMinutes(sum.o60)}</td>
                <td />
                <td />
                <td className="r">{fmtYen(sum.amount)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      <p className="xs muted" style={{ lineHeight: 1.7 }}>
        残業代 ＝ 時間単価 × 区分ごとの時間 × 割増率（時間外1.25・深夜＋0.25・法定休日1.35・60時間超1.50）。月合計で1円未満を四捨五入します。時間単価は表示上1円単位に丸めていますが、計算には丸める前の値を使います。
      </p>
    </>
  );
}
