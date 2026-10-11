import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { db } from "./db";
import * as t from "@/db/schema";
import type { Employee, OvertimeRequest, Salary, Setting, TimeRecord } from "@/db/schema";
import {
  calcMonth,
  effectiveInterval,
  hourlyRate,
  overtimePay,
  type DayType,
  type MonthTotals,
  type Segment,
} from "./overtime";
import { monthBounds, shiftYm, weekdayOf } from "./time";

export async function getSettings(): Promise<Setting> {
  const row = await db.query.settings.findFirst({ where: eq(t.settings.id, 1) });
  if (row) return row;
  const [created] = await db.insert(t.settings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.query.settings.findFirst({ where: eq(t.settings.id, 1) }))!;
}

/** 休日カレンダー（"YYYY-MM-DD" → 法定休日か） */
export async function getHolidayMap(fromYmd: string, toYmd: string): Promise<Map<string, boolean>> {
  const rows = await db.select().from(t.holidays).where(and(gte(t.holidays.date, fromYmd), lte(t.holidays.date, toYmd)));
  return new Map(rows.map((h) => [h.date, h.isLegal]));
}

export function dayTypeOf(ymd: string, s: Setting, holidays: Map<string, boolean>): DayType {
  const h = holidays.get(ymd);
  if (h !== undefined) return h ? "legalHoliday" : "companyHoliday";
  const wd = weekdayOf(ymd);
  if (wd === s.legalHolidayWeekday) return "legalHoliday";
  const company = s.companyHolidayWeekdays
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => !Number.isNaN(x));
  return company.includes(wd) ? "companyHoliday" : "workday";
}

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  workday: "平日",
  companyHoliday: "所定休日",
  legalHoliday: "法定休日",
};

export async function isMonthClosed(ym: string): Promise<boolean> {
  const row = await db.query.monthlyCloses.findFirst({ where: eq(t.monthlyCloses.yearMonth, ym) });
  return !!row;
}

/** 対象月の末日時点で有効な給与 */
export async function salaryFor(employeeId: string, ym: string): Promise<Salary | null> {
  const { last } = monthBounds(ym);
  const row = await db.query.salaries.findFirst({
    where: and(eq(t.salaries.employeeId, employeeId), lte(t.salaries.effectiveFrom, last)),
    orderBy: [desc(t.salaries.effectiveFrom), desc(t.salaries.createdAt)],
  });
  return row ?? null;
}

export type RequestWithRecord = OvertimeRequest & { timeRecord: TimeRecord | null };

export async function monthRequests(employeeId: string, ym: string): Promise<RequestWithRecord[]> {
  const { first, last } = monthBounds(ym);
  return db.query.overtimeRequests.findMany({
    where: and(eq(t.overtimeRequests.employeeId, employeeId), gte(t.overtimeRequests.workDate, first), lte(t.overtimeRequests.workDate, last)),
    with: { timeRecord: true },
    orderBy: [desc(t.overtimeRequests.workDate), desc(t.overtimeRequests.plannedStart)],
  });
}

/** 承認済み・終了打刻ありの申請を、実績の区間に変換する */
export function toSegments(requests: RequestWithRecord[], s: Setting, holidays: Map<string, boolean>): Segment[] {
  const out: Segment[] = [];
  for (const r of requests) {
    const rec = r.timeRecord;
    if (r.status !== "APPROVED" || !rec?.endedAt) continue;
    const iv = effectiveInterval(
      { start: r.plannedStart, end: r.plannedEnd },
      { start: rec.startedAt, end: rec.endedAt },
      rec.excessStatus === "APPROVED",
    );
    if (iv) out.push({ workDate: r.workDate, ...iv, breakMinutes: rec.breakMinutes, dayType: dayTypeOf(r.workDate, s, holidays) });
  }
  return out;
}

/** 見込み用の区間。承認済み・打刻済みは実績、それ以外（申請中・未打刻）は予定時間を使う */
function toProjectedSegments(requests: RequestWithRecord[], s: Setting, holidays: Map<string, boolean>): Segment[] {
  const out: Segment[] = [];
  for (const r of requests) {
    if (r.status !== "APPROVED" && r.status !== "PENDING") continue;
    const rec = r.timeRecord;
    const done = r.status === "APPROVED" && rec?.endedAt ? rec : null;
    const iv = done
      ? effectiveInterval({ start: r.plannedStart, end: r.plannedEnd }, { start: done.startedAt, end: done.endedAt! }, done.excessStatus === "APPROVED")
      : { start: r.plannedStart, end: r.plannedEnd };
    if (iv) out.push({ workDate: r.workDate, ...iv, breakMinutes: done?.breakMinutes ?? 0, dayType: dayTypeOf(r.workDate, s, holidays) });
  }
  return out;
}

type EmpLite = Pick<Employee, "id" | "name" | "email">;

export interface EmployeeMonth {
  employee: EmpLite;
  ym: string;
  totals: MonthTotals;
  hourlyRate: number | null;
  amount: number | null;
  payType: "MONTHLY" | "HOURLY" | null;
}

interface Ctx {
  settings: Setting;
  holidays: Map<string, boolean>;
}

async function ctxFor(ym: string, ctx?: Ctx): Promise<Ctx> {
  if (ctx) return ctx;
  const { first, last } = monthBounds(ym);
  return { settings: await getSettings(), holidays: await getHolidayMap(first, last) };
}

/** 1人・1か月の集計（その時点の給与マスタで計算） */
export async function computeEmployeeMonth(employee: EmpLite, ym: string, ctx?: Ctx): Promise<EmployeeMonth> {
  const { settings, holidays } = await ctxFor(ym, ctx);
  const totals = calcMonth(toSegments(await monthRequests(employee.id, ym), settings, holidays), settings);
  const sal = await salaryFor(employee.id, ym);
  if (!sal) return { employee, ym, totals, hourlyRate: null, amount: null, payType: null };
  return {
    employee,
    ym,
    totals,
    hourlyRate: hourlyRate(sal, settings),
    amount: overtimePay(totals.weighted100, sal, settings),
    payType: sal.payType,
  };
}

/** 申請中も含めた当月の見込み（36協定の警告用） */
export async function projectedMonth(employeeId: string, ym: string, extra?: Omit<Segment, "dayType">) {
  const { settings, holidays } = await ctxFor(ym);
  const segs = toProjectedSegments(await monthRequests(employeeId, ym), settings, holidays);
  if (extra) segs.push({ ...extra, dayType: dayTypeOf(extra.workDate, settings, holidays) });
  return { totals: calcMonth(segs, settings), settings };
}

/** 月次集計の一覧。確定済みの月はスナップショットを返す */
export async function monthSummaries(ym: string): Promise<{ closed: boolean; rows: EmployeeMonth[] }> {
  const closed = await isMonthClosed(ym);
  if (closed) {
    const snaps = await db.query.monthlySummaries.findMany({
      where: eq(t.monthlySummaries.yearMonth, ym),
      with: { employee: true },
    });
    snaps.sort((a, b) => a.employee.name.localeCompare(b.employee.name, "ja"));
    return {
      closed,
      rows: snaps.map((x) => ({
        employee: x.employee,
        ym,
        totals: {
          innerMinutes: x.innerMinutes,
          statutoryMinutes: x.statutoryMinutes,
          over60Minutes: x.over60Minutes,
          nightMinutes: x.nightMinutes,
          holidayMinutes: x.holidayMinutes,
          weighted100: 0,
        },
        hourlyRate: x.hourlyRate,
        amount: x.amount,
        payType: null,
      })),
    };
  }

  const ctx = await ctxFor(ym);
  const { first, last } = monthBounds(ym);
  const withData = db
    .selectDistinct({ id: t.overtimeRequests.employeeId })
    .from(t.overtimeRequests)
    .where(and(gte(t.overtimeRequests.workDate, first), lte(t.overtimeRequests.workDate, last)));
  const emps = await db
    .select()
    .from(t.employees)
    .where(or(eq(t.employees.isActive, true), inArray(t.employees.id, withData)))
    .orderBy(asc(t.employees.name));
  const rows: EmployeeMonth[] = [];
  for (const e of emps) rows.push(await computeEmployeeMonth(e, ym, ctx));
  return { closed, rows };
}

/** 36協定：起算月からの年間累計・月上限超えの回数・2〜6か月平均の最大値（休日労働を含む） */
export async function agreementStats(employee: EmpLite, ym: string) {
  const s = await getSettings();
  const [y, m] = ym.split("-").map(Number);
  const startYear = m >= s.agreementStartMonth ? y : y - 1;
  const startYm = `${startYear}-${String(s.agreementStartMonth).padStart(2, "0")}`;

  const months: { ym: string; statutory: number; withHoliday: number }[] = [];
  for (let cur = ym, i = 0; i < 12; cur = shiftYm(cur, -1), i++) {
    const r = await computeEmployeeMonth(employee, cur);
    months.push({ ym: cur, statutory: r.totals.statutoryMinutes, withHoliday: r.totals.statutoryMinutes + r.totals.holidayMinutes });
  }
  const inYear = months.filter((x) => x.ym >= startYm);
  let maxAvg = 0;
  for (let n = 2; n <= 6; n++) {
    maxAvg = Math.max(maxAvg, months.slice(0, n).reduce((a, x) => a + x.withHoliday, 0) / n);
  }
  return {
    yearMinutes: inYear.reduce((a, x) => a + x.statutory, 0),
    over45Count: inYear.filter((x) => x.statutory > s.limitMonthMinutes).length,
    maxAvgMinutes: Math.round(maxAvg),
    startYm,
    settings: s,
  };
}

export function percentOfLimit(minutes: number, limit: number): number {
  return limit > 0 ? Math.round((minutes / limit) * 100) : 0;
}
