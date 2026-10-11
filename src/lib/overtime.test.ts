import { describe, expect, it } from "vitest";
import { calcMonth, effectiveInterval, excessMinutes, hourlyRate, overtimePay, type DayType, type Segment } from "./overtime";
import { addDays, jstDateTime, paydayOf } from "./time";

const STD = { dailyMinutes: 480, premiumForInner: false };
const PAY_RULES = { dailyMinutes: 480, annualHolidays: 120 };

/** ymd の hm から minutes 分の区間 */
function seg(ymd: string, hm: string, minutes: number, dayType: DayType = "workday", breakMinutes = 0): Segment {
  const start = jstDateTime(ymd, hm);
  return { workDate: ymd, start, end: new Date(start.getTime() + minutes * 60_000), breakMinutes, dayType };
}

/** 2h（18:00–20:00）の平日残業を n 日分 */
function evenings(n: number, minutes = 120): Segment[] {
  return Array.from({ length: n }, (_, i) => seg(addDays("2026-09-01", i), "18:00", minutes));
}

const monthly = (base: number, allow = 0) => ({ payType: "MONTHLY" as const, basePay: base, includedAllowances: allow, hourlyWage: null });

describe("calcMonth の区分", () => {
  it("22時〜翌5時を深夜として数える（日をまたぐ）", () => {
    const t = calcMonth([seg("2026-09-01", "18:00", 8 * 60)], STD); // 18:00〜翌2:00
    expect(t.statutoryMinutes).toBe(480);
    expect(t.nightMinutes).toBe(240);
    expect(t.weighted100).toBe(480 * 125 + 240 * 25);
  });

  it("月60時間を超えた時間外は1.50", () => {
    const t = calcMonth(evenings(35), STD); // 70時間
    expect(t.statutoryMinutes).toBe(4200);
    expect(t.over60Minutes).toBe(600);
    expect(t.weighted100).toBe(3600 * 125 + 600 * 150);
  });

  it("法定休日は1.35で、60時間の判定に含めない", () => {
    const t = calcMonth([...evenings(30), seg("2026-09-06", "09:00", 600, "legalHoliday")], STD);
    expect(t.holidayMinutes).toBe(600);
    expect(t.over60Minutes).toBe(0);
    expect(t.weighted100).toBe(3600 * 125 + 600 * 135);
  });

  it("所定7.5時間なら、1日30分までは法定内残業", () => {
    const t = calcMonth([seg("2026-09-01", "17:30", 60), seg("2026-09-01", "20:00", 60)], { dailyMinutes: 450, premiumForInner: false });
    expect(t.innerMinutes).toBe(30);
    expect(t.statutoryMinutes).toBe(90);
    expect(t.weighted100).toBe(30 * 100 + 90 * 125);
  });

  it("所定休日（土曜）は全て時間外", () => {
    const t = calcMonth([seg("2026-09-05", "09:00", 180, "companyHoliday")], { dailyMinutes: 450, premiumForInner: false });
    expect(t.innerMinutes).toBe(0);
    expect(t.statutoryMinutes).toBe(180);
  });

  it("休憩を控除する", () => {
    const t = calcMonth([seg("2026-09-01", "18:00", 240, "workday", 30)], STD);
    expect(t.statutoryMinutes).toBe(210);
  });
});

describe("残業代（UIサンプルと同じ値になること）", () => {
  it("佐藤：月給340,000円、時間外32時間（うち深夜2時間）→ 84,306円", () => {
    const t = calcMonth([seg("2026-09-01", "18:00", 360), ...evenings(13).map((s, i) => seg(addDays("2026-09-02", i), "18:00", 120))], STD);
    expect(t.statutoryMinutes).toBe(32 * 60);
    expect(t.nightMinutes).toBe(120);
    expect(overtimePay(t.weighted100, monthly(320000, 20000), PAY_RULES)).toBe(84306);
  });

  it("高橋：月給410,000円、時間外41時間（深夜4時間）＋法定休日8時間 → 158,268円", () => {
    const segs = [
      seg("2026-09-01", "18:00", 480),
      ...Array.from({ length: 11 }, (_, i) => seg(addDays("2026-09-02", i), "18:00", 180)),
      seg("2026-09-20", "09:00", 480, "legalHoliday"),
    ];
    const t = calcMonth(segs, STD);
    expect(t.statutoryMinutes).toBe(41 * 60);
    expect(t.nightMinutes).toBe(240);
    expect(t.holidayMinutes).toBe(480);
    expect(overtimePay(t.weighted100, monthly(380000, 30000), PAY_RULES)).toBe(158268);
  });

  it("鈴木：月給280,000円、18時間30分 → 39,643円", () => {
    const t = calcMonth([...evenings(9), seg("2026-09-20", "18:00", 30)], STD);
    expect(overtimePay(t.weighted100, monthly(280000), PAY_RULES)).toBe(39643);
  });

  it("伊藤：月給310,000円、12時間45分 → 30,249円", () => {
    const t = calcMonth([...evenings(6), seg("2026-09-20", "18:00", 45)], STD);
    expect(overtimePay(t.weighted100, monthly(300000, 10000), PAY_RULES)).toBe(30249);
  });

  it("田中：時給1,500円、6時間 → 11,250円", () => {
    const t = calcMonth(evenings(3), STD);
    expect(overtimePay(t.weighted100, { payType: "HOURLY", basePay: 0, includedAllowances: 0, hourlyWage: 1500 }, PAY_RULES)).toBe(11250);
  });

  it("時間単価 = (基本給＋算入手当) ÷ 月平均所定労働時間", () => {
    expect(hourlyRate(monthly(380000, 30000), PAY_RULES)).toBeCloseTo(2510.204, 3);
  });
});

describe("予定超過", () => {
  const planned = { start: jstDateTime("2026-10-07", "18:00"), end: jstDateTime("2026-10-07", "19:00") };
  const actual = { start: jstDateTime("2026-10-07", "18:00"), end: jstDateTime("2026-10-07", "19:45") };

  it("超過分を数える", () => {
    expect(excessMinutes(planned, actual)).toBe(45);
  });
  it("未承認なら予定の範囲まで、承認済みなら打刻どおり", () => {
    expect(effectiveInterval(planned, actual, false)?.end).toEqual(planned.end);
    expect(effectiveInterval(planned, actual, true)?.end).toEqual(actual.end);
  });
});

describe("支払日", () => {
  it("9月分は10/25が日曜のため10/23（金）", () => {
    expect(paydayOf("2026-09")).toBe("2026-10-23");
  });
  it("10月分は11/25（水）", () => {
    expect(paydayOf("2026-10")).toBe("2026-11-25");
  });
  it("休日も避ける", () => {
    expect(paydayOf("2026-10", new Set(["2026-11-25"]))).toBe("2026-11-24");
  });
});
