import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { holidays } from "@/db/schema";
import { getSettings } from "@/lib/payroll";
import { fmtDateLong } from "@/lib/time";
import { domainsLabel } from "@/lib/domains";
import { Flash, one, type SP } from "@/components/flash";
import { addHoliday, deleteHolidays, saveSettings } from "../actions";

export const metadata = { title: "システム設定" };

const WD = ["日", "月", "火", "水", "木", "金", "土"];

export default async function SettingsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const s = await getSettings();
  const hs = await db.select().from(holidays).orderBy(asc(holidays.date));
  const company = new Set(s.companyHolidayWeekdays.split(",").filter(Boolean).map(Number));
  const domain = domainsLabel();

  return (
    <>
      <header className="stack" style={{ gap: 4 }}>
        <h1>システム設定</h1>
        <p className="small muted">就業規則・36協定に合わせて設定します。確定前の月の金額から、新しい設定で計算されます。</p>
      </header>
      <Flash msg={one(sp.msg)} err={one(sp.err)} />

      <form action={saveSettings} className="card stack" style={{ maxWidth: 720, gap: 18 }}>
        <h2>労働条件・36協定</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="dailyHours">1日の所定労働時間（時間）</label><input id="dailyHours" name="dailyHours" type="number" step="0.25" min={1} max={8} defaultValue={s.dailyMinutes / 60} className="input num" /></div>
          <div className="field"><label htmlFor="annualHolidays">年間所定休日数（日）</label><input id="annualHolidays" name="annualHolidays" type="number" min={0} max={200} defaultValue={s.annualHolidays} className="input num" /></div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="legalHolidayWeekday">法定休日の曜日</label>
            <select id="legalHolidayWeekday" name="legalHolidayWeekday" defaultValue={s.legalHolidayWeekday} className="select">
              {WD.map((w, i) => <option key={w} value={i}>{w}曜日</option>)}
            </select>
          </div>
          <fieldset style={{ margin: 0, padding: 0, border: "none" }}>
            <legend className="label" style={{ marginBottom: 6 }}>所定休日の曜日</legend>
            <div className="row" style={{ gap: 12 }}>
              {WD.map((w, i) => (
                <label key={w} htmlFor={`cw-${i}`} className="row" style={{ gap: 4 }}>
                  <input id={`cw-${i}`} type="checkbox" name="companyWeekday" value={i} defaultChecked={company.has(i)} />{w}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <label htmlFor="premiumForInner" className="row" style={{ gap: 8 }}>
          <input id="premiumForInner" type="checkbox" name="premiumForInner" defaultChecked={s.premiumForInner} />
          所定を超え1日8時間以内の「法定内残業」にも1.25倍を付ける
        </label>
        <div className="grid2">
          <div className="field"><label htmlFor="limitMonthHours">36協定 月の上限（時間）</label><input id="limitMonthHours" name="limitMonthHours" type="number" step="0.5" min={1} max={100} defaultValue={s.limitMonthMinutes / 60} className="input num" /></div>
          <div className="field"><label htmlFor="limitYearHours">36協定 年の上限（時間）</label><input id="limitYearHours" name="limitYearHours" type="number" step="1" min={1} max={720} defaultValue={s.limitYearMinutes / 60} className="input num" /></div>
          <div className="field"><label htmlFor="agreementStartMonth">36協定の起算月</label><input id="agreementStartMonth" name="agreementStartMonth" type="number" min={1} max={12} defaultValue={s.agreementStartMonth} className="input num" /></div>
          <div className="field"><label htmlFor="warnPercent">注意を出す割合（上限の%）</label><input id="warnPercent" name="warnPercent" type="number" min={10} max={100} defaultValue={s.warnPercent} className="input num" /></div>
        </div>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }}>保存</button>
      </form>

      <section className="stack" style={{ maxWidth: 720, gap: 10 }}>
        <div className="stack" style={{ gap: 2 }}>
          <h2>祝日・会社休日</h2>
          <p className="small muted">登録した日は、曜日に関係なく休日として扱います。祝日は所定休日（時間外労働）、法定休日にチェックを入れると1.35倍で計算します。支払日の営業日判定にも使います。</p>
        </div>
        <form action={addHoliday} className="card row" style={{ gap: 12, alignItems: "flex-end" }}>
          <div className="field"><label htmlFor="h-date">日付</label><input id="h-date" name="date" type="date" className="input" required /></div>
          <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="h-name">名称</label><input id="h-name" name="name" className="input" placeholder="例：夏季休業" required /></div>
          <label htmlFor="h-legal" className="row" style={{ gap: 6, minHeight: 46 }}><input id="h-legal" type="checkbox" name="isLegal" />法定休日</label>
          <button type="submit" className="btn primary" style={{ minHeight: 46 }}>追加</button>
        </form>
        <form action={deleteHolidays} className="stack">
          <div className="tablewrap" style={{ maxHeight: 360, overflowY: "auto" }}>
            <table className="tb">
              <thead><tr><th /><th>日付</th><th>名称</th><th>区分</th></tr></thead>
              <tbody>
                {hs.map((h) => (
                  <tr key={h.date}>
                    <td><input type="checkbox" name="dates" value={h.date} aria-label={`${h.name}を選択`} /></td>
                    <td>{fmtDateLong(h.date)}</td>
                    <td>{h.name}</td>
                    <td>{h.isLegal ? <span className="chip bad">法定休日</span> : <span className="chip wait">所定休日</span>}</td>
                  </tr>
                ))}
                {hs.length === 0 && <tr><td colSpan={4} className="muted">登録がありません。</td></tr>}
              </tbody>
            </table>
          </div>
          <div><button type="submit" className="btn sm danger">選択した休日を削除</button></div>
        </form>
      </section>

      <section className="card stack" style={{ maxWidth: 720 }}>
        <h2>ログインの設定（環境変数）</h2>
        <p className="small muted">許可ドメイン：<span className="mono">{domain || "（未設定：どのドメインも許可）"}</span>。変更は環境変数 ALLOWED_DOMAIN を編集して再起動（再デプロイ）してください。複数ある場合はカンマ区切りです。</p>
      </section>
    </>
  );
}
