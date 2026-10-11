// 残業時間の区分と残業代の計算（仕様書 3章）。DBに依存しない純粋関数。
//
// 区分と割増率（×100 の整数で扱い、丸めは最後に1回だけ）
//   法定内残業   … 所定労働時間を超え1日8時間以内     100（設定で125）
//   時間外労働   … 1日8時間超・所定休日の労働          125
//   60時間超     … 当月の時間外労働のうち60時間超     150
//   法定休日労働 …                                     135
//   深夜（22〜5時）… 上記に +25
//
// 前提
//   - 週40時間の判定は、通常勤務を記録しないため行わない（所定休日の労働を時間外として扱う）。
//   - 区分・月の判定は申請の対象日（workDate）で行う。日をまたいでも対象日の労働とする。
//   - 休憩は残業開始時点からとったものとして控除する。

import { jstHour } from "./time";

export type DayType = "workday" | "companyHoliday" | "legalHoliday";

export interface Segment {
  workDate: string; // "YYYY-MM-DD"
  start: Date;
  end: Date;
  breakMinutes: number;
  dayType: DayType;
}

export interface Rules {
  /** 1日の所定労働時間（分） */
  dailyMinutes: number;
  /** 法定内残業にも1.25倍を付けるか */
  premiumForInner: boolean;
}

export interface MonthTotals {
  /** 法定内残業 */
  innerMinutes: number;
  /** 時間外労働（法定外、所定休日を含む。60時間超の分も含む） */
  statutoryMinutes: number;
  /** うち月60時間を超えた分 */
  over60Minutes: number;
  /** 深夜（全区分） */
  nightMinutes: number;
  /** 法定休日労働 */
  holidayMinutes: number;
  /** Σ(1分ごとの割増率×100)。残業代 = 1分あたり単価 × weighted100 / 100 */
  weighted100: number;
}

const LEGAL_DAILY_MINUTES = 8 * 60;
const SIXTY_HOURS = 60 * 60;
const MINUTE = 60_000;

export function isNight(t: Date): boolean {
  const h = jstHour(t);
  return h >= 22 || h < 5;
}

export function calcMonth(segments: Segment[], rules: Rules): MonthTotals {
  const totals: MonthTotals = {
    innerMinutes: 0,
    statutoryMinutes: 0,
    over60Minutes: 0,
    nightMinutes: 0,
    holidayMinutes: 0,
    weighted100: 0,
  };
  const innerCap = Math.max(0, LEGAL_DAILY_MINUTES - rules.dailyMinutes);
  const innerRate = rules.premiumForInner ? 125 : 100;
  const innerUsed = new Map<string, number>();
  let statutoryCount = 0;

  const sorted = [...segments].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const seg of sorted) {
    const total = Math.floor((seg.end.getTime() - seg.start.getTime()) / MINUTE);
    for (let i = Math.max(0, seg.breakMinutes); i < total; i++) {
      const t = new Date(seg.start.getTime() + i * MINUTE);
      const night = isNight(t);
      let rate: number;

      if (seg.dayType === "legalHoliday") {
        totals.holidayMinutes++;
        rate = 135;
      } else {
        const used = innerUsed.get(seg.workDate) ?? 0;
        if (seg.dayType === "workday" && used < innerCap) {
          innerUsed.set(seg.workDate, used + 1);
          totals.innerMinutes++;
          rate = innerRate;
        } else {
          statutoryCount++;
          totals.statutoryMinutes++;
          if (statutoryCount > SIXTY_HOURS) {
            totals.over60Minutes++;
            rate = 150;
          } else {
            rate = 125;
          }
        }
      }
      if (night) {
        totals.nightMinutes++;
        rate += 25;
      }
      totals.weighted100 += rate;
    }
  }
  return totals;
}

export interface PayInput {
  payType: "MONTHLY" | "HOURLY";
  basePay: number;
  includedAllowances: number;
  hourlyWage: number | null;
}

export interface PayRules {
  dailyMinutes: number;
  annualHolidays: number;
}

/** 月平均所定労働時間（分） = (365 − 年間休日) × 1日の所定 ÷ 12 */
export function avgMonthlyMinutes(r: PayRules): number {
  return ((365 - r.annualHolidays) * r.dailyMinutes) / 12;
}

/** 1時間あたり単価（表示用、丸めない） */
export function hourlyRate(pay: PayInput, r: PayRules): number {
  if (pay.payType === "HOURLY") return pay.hourlyWage ?? 0;
  return ((pay.basePay + pay.includedAllowances) * 60) / avgMonthlyMinutes(r);
}

/** 残業代（円）。月合計で1円未満を四捨五入する。 */
export function overtimePay(weighted100: number, pay: PayInput, r: PayRules): number {
  if (weighted100 <= 0) return 0;
  if (pay.payType === "HOURLY") {
    return Math.round(((pay.hourlyWage ?? 0) * weighted100) / (100 * 60));
  }
  const monthly = pay.basePay + pay.includedAllowances;
  // monthly × 12 × W / (100 × (365 − 休日) × 所定分) を整数のまま計算し、最後に1回割る
  const num = monthly * 12 * weighted100;
  const den = 100 * (365 - r.annualHolidays) * r.dailyMinutes;
  return Math.round(num / den);
}

/** 承認された予定と実際の打刻から、実績として数える区間を返す */
export function effectiveInterval(
  planned: { start: Date; end: Date },
  actual: { start: Date; end: Date },
  excessApproved: boolean,
): { start: Date; end: Date } | null {
  const start = excessApproved ? actual.start : new Date(Math.max(actual.start.getTime(), planned.start.getTime()));
  const end = excessApproved ? actual.end : new Date(Math.min(actual.end.getTime(), planned.end.getTime()));
  return end.getTime() > start.getTime() ? { start, end } : null;
}

/** 予定の範囲外で働いた分（分） */
export function excessMinutes(planned: { start: Date; end: Date }, actual: { start: Date; end: Date }): number {
  const early = Math.max(0, planned.start.getTime() - actual.start.getTime());
  const late = Math.max(0, actual.end.getTime() - planned.end.getTime());
  return Math.floor((early + late) / MINUTE);
}
