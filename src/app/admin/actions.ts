"use server";

import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import * as t from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { computeEmployeeMonth, getHolidayMap, getSettings, isMonthClosed, type EmployeeMonth } from "@/lib/payroll";
import { logChange } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { fmtDateShort, hmOf, isValidYm, jstDateTime, monthBounds, ymOf } from "@/lib/time";

function back(path: string, kind: "msg" | "err", text: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(text)}`);
}
const refresh = () => revalidatePath("/", "layout");
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- 承認 ---------- */

async function decide(adminId: string, id: string, status: "APPROVED" | "REJECTED", comment?: string) {
  const req = await db.query.overtimeRequests.findFirst({ where: eq(t.overtimeRequests.id, id), with: { employee: true } });
  if (!req) return "申請が見つかりません。";
  if (req.status !== "PENDING") return "すでに処理済みの申請です。";
  if (await isMonthClosed(ymOf(req.workDate))) return `${ymOf(req.workDate)}は月次確定済みのため処理できません。確定を解除してください。`;
  await db.transaction(async (tx) => {
    await tx
      .update(t.overtimeRequests)
      .set({ status, approverId: adminId, decidedAt: new Date(), rejectComment: status === "REJECTED" ? comment : null })
      .where(eq(t.overtimeRequests.id, id));
    await logChange(tx, { table: "overtime_requests", id, by: adminId, before: { status: req.status }, after: { status, comment }, reason: status === "APPROVED" ? "承認" : "却下" });
  });
  await notify(
    req.employee.email,
    status === "APPROVED" ? "残業申請が承認されました" : "残業申請が却下されました",
    `${fmtDateShort(req.workDate)} ${hmOf(req.plannedStart)}–${hmOf(req.plannedEnd)}${comment ? `\n理由：${comment}` : ""}`,
  );
  return null;
}

export async function approveRequest(fd: FormData) {
  const admin = await requireAdmin();
  const err = await decide(admin.id, String(fd.get("id") ?? ""), "APPROVED");
  refresh();
  back("/admin/approvals", err ? "err" : "msg", err ?? "承認しました。");
}

export async function rejectRequest(fd: FormData) {
  const admin = await requireAdmin();
  const comment = String(fd.get("comment") ?? "").trim();
  if (!comment) back("/admin/approvals", "err", "却下するときは理由を入力してください。");
  const err = await decide(admin.id, String(fd.get("id") ?? ""), "REJECTED", comment);
  refresh();
  back("/admin/approvals", err ? "err" : "msg", err ?? "却下しました。");
}

export async function bulkApprove(fd: FormData) {
  const admin = await requireAdmin();
  const ids = fd.getAll("ids").map(String);
  if (ids.length === 0) back("/admin/approvals", "err", "承認する申請を選んでください。");
  let ok = 0;
  let firstErr: string | null = null;
  for (const id of ids) {
    const err = await decide(admin.id, id, "APPROVED");
    if (err) firstErr ??= err;
    else ok++;
  }
  refresh();
  back("/admin/approvals", ok > 0 ? "msg" : "err", `${ok}件を承認しました。${firstErr ? `（${firstErr}）` : ""}`);
}

export async function decideExcess(fd: FormData) {
  const admin = await requireAdmin();
  const id = String(fd.get("recordId") ?? "");
  const approve = fd.get("approve") === "1";
  const rec = await db.query.timeRecords.findFirst({ where: eq(t.timeRecords.id, id), with: { request: true } });
  if (!rec || rec.excessStatus !== "PENDING") back("/admin/approvals", "err", "すでに処理済みです。");
  if (await isMonthClosed(ymOf(rec.request.workDate))) back("/admin/approvals", "err", "月次確定済みのため処理できません。");
  await db.transaction(async (tx) => {
    await tx.update(t.timeRecords).set({ excessStatus: approve ? "APPROVED" : "REJECTED" }).where(eq(t.timeRecords.id, id));
    await logChange(tx, { table: "time_records", id, by: admin.id, before: { excessStatus: "PENDING" }, after: { excessStatus: approve ? "APPROVED" : "REJECTED" }, reason: "予定超過の判断" });
  });
  refresh();
  back("/admin/approvals", "msg", approve ? "超過分を承認しました。" : "超過分は計上しないことにしました。");
}

/** 承認済みの申請を管理者が取り消す（理由必須） */
export async function cancelApproved(fd: FormData) {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  const to = String(fd.get("to") ?? "/admin/approvals");
  if (!reason) back(to, "err", "取り消す理由を入力してください。");
  const req = await db.query.overtimeRequests.findFirst({ where: eq(t.overtimeRequests.id, id) });
  if (!req || req.status !== "APPROVED") back(to, "err", "承認済みの申請ではありません。");
  if (await isMonthClosed(ymOf(req.workDate))) back(to, "err", "月次確定済みのため処理できません。");
  await db.transaction(async (tx) => {
    await tx.update(t.overtimeRequests).set({ status: "CANCELED" }).where(eq(t.overtimeRequests.id, id));
    await logChange(tx, { table: "overtime_requests", id, by: admin.id, before: { status: "APPROVED" }, after: { status: "CANCELED" }, reason });
  });
  refresh();
  back(to, "msg", "承認を取り消しました。");
}

/* ---------- 打刻の修正（社員別詳細） ---------- */

export async function correctRecord(fd: FormData) {
  const admin = await requireAdmin();
  const id = String(fd.get("recordId") ?? "");
  const to = String(fd.get("to") ?? "/admin/employees");
  const startHm = String(fd.get("start") ?? "");
  const endHm = String(fd.get("end") ?? "");
  const breakMinutes = Math.max(0, Math.min(600, Math.floor(Number(fd.get("breakMinutes") ?? 0) || 0)));
  const reason = String(fd.get("reason") ?? "").trim();
  if (!/^\d\d:\d\d$/.test(startHm) || !/^\d\d:\d\d$/.test(endHm)) back(to, "err", "開始と終了の時刻を入力してください。");
  if (!reason) back(to, "err", "修正の理由を入力してください。");

  const rec = await db.query.timeRecords.findFirst({ where: eq(t.timeRecords.id, id), with: { request: true } });
  if (!rec) back(to, "err", "打刻が見つかりません。");
  if (await isMonthClosed(ymOf(rec.request.workDate))) back(to, "err", "月次確定済みのため修正できません。確定を解除してください。");

  const startedAt = jstDateTime(rec.request.workDate, startHm);
  let endedAt = jstDateTime(rec.request.workDate, endHm);
  if (endedAt <= startedAt) endedAt = new Date(endedAt.getTime() + 24 * 3600_000);
  const before = { startedAt: rec.startedAt, endedAt: rec.endedAt, breakMinutes: rec.breakMinutes };
  const planned = rec.request;
  const exceeds = startedAt < planned.plannedStart || endedAt > planned.plannedEnd;

  await db.transaction(async (tx) => {
    await tx
      .update(t.timeRecords)
      .set({
        startedAt,
        endedAt,
        breakMinutes,
        corrected: true,
        correctionRequest: null,
        excessStatus: exceeds ? (rec.excessStatus === "APPROVED" ? "APPROVED" : "PENDING") : "NONE",
      })
      .where(eq(t.timeRecords.id, id));
    await logChange(tx, { table: "time_records", id, by: admin.id, before, after: { startedAt, endedAt, breakMinutes }, reason });
  });
  refresh();
  back(to, "msg", "打刻を修正しました。変更履歴に記録しています。");
}

/* ---------- 月次確定 ---------- */

export async function closeMonth(fd: FormData) {
  const admin = await requireAdmin();
  const ym = String(fd.get("ym") ?? "");
  const to = `/admin/monthly?m=${ym}`;
  if (!isValidYm(ym)) back("/admin/monthly", "err", "月が正しくありません。");
  if (await isMonthClosed(ym)) back(to, "err", "すでに確定済みです。");

  const { first, last } = monthBounds(ym);
  const pendingAny = (
    await db.select({ id: t.overtimeRequests.id, d: t.overtimeRequests.workDate }).from(t.overtimeRequests).where(eq(t.overtimeRequests.status, "PENDING"))
  ).filter((r) => r.d >= first && r.d <= last);
  if (pendingAny.length > 0) back(to, "err", `承認待ちの申請が${pendingAny.length}件あります。先に承認または却下してください。`);

  const unfinished = (
    await db.query.timeRecords.findMany({ with: { request: true } })
  ).filter((r) => !r.endedAt && r.request.workDate >= first && r.request.workDate <= last && r.request.status !== "REJECTED" && r.request.status !== "CANCELED");
  if (unfinished.length > 0) back(to, "err", `終了打刻がない打刻が${unfinished.length}件あります。社員別詳細で修正してください。`);
  const excessPending = (await db.query.timeRecords.findMany({ with: { request: true } })).filter(
    (r) => r.excessStatus === "PENDING" && r.request.workDate >= first && r.request.workDate <= last,
  );
  if (excessPending.length > 0) back(to, "err", `予定超過の承認待ちが${excessPending.length}件あります。先に判断してください。`);

  const settings = await getSettings();
  const holidays = await getHolidayMap(first, last);
  const emps = await db.select().from(t.employees);
  const rows: EmployeeMonth[] = [];
  for (const e of emps) {
    const r = await computeEmployeeMonth(e, ym, { settings, holidays });
    const any = r.totals.innerMinutes + r.totals.statutoryMinutes + r.totals.holidayMinutes > 0;
    if (any || e.isActive) rows.push(r);
  }
  const noSalary = rows.filter((r) => r.hourlyRate === null && r.totals.statutoryMinutes + r.totals.innerMinutes + r.totals.holidayMinutes > 0);
  if (noSalary.length > 0) back(to, "err", `給与マスタが未登録の社員がいます：${noSalary.map((r) => r.employee.name).join("、")}`);

  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.insert(t.monthlySummaries).values({
        employeeId: r.employee.id,
        yearMonth: ym,
        innerMinutes: r.totals.innerMinutes,
        statutoryMinutes: r.totals.statutoryMinutes,
        over60Minutes: r.totals.over60Minutes,
        nightMinutes: r.totals.nightMinutes,
        holidayMinutes: r.totals.holidayMinutes,
        hourlyRate: r.hourlyRate,
        amount: r.amount,
      });
    }
    await tx.insert(t.monthlyCloses).values({ yearMonth: ym, closedById: admin.id });
    await logChange(tx, { table: "monthly_closes", id: ym, by: admin.id, after: { closed: true }, reason: "月次確定" });
  });
  refresh();
  back(to, "msg", `${ym}を確定しました。`);
}

export async function reopenMonth(fd: FormData) {
  const admin = await requireAdmin();
  const ym = String(fd.get("ym") ?? "");
  const to = `/admin/monthly?m=${ym}`;
  if (!isValidYm(ym)) back("/admin/monthly", "err", "月が正しくありません。");
  await db.transaction(async (tx) => {
    await tx.delete(t.monthlySummaries).where(eq(t.monthlySummaries.yearMonth, ym));
    await tx.delete(t.monthlyCloses).where(eq(t.monthlyCloses.yearMonth, ym));
    await logChange(tx, { table: "monthly_closes", id: ym, by: admin.id, before: { closed: true }, after: { closed: false }, reason: "確定解除" });
  });
  refresh();
  back(to, "msg", `${ym}の確定を解除しました。`);
}

/* ---------- マスタ ---------- */

const EmployeeInput = z.object({
  name: z.string().trim().min(1, "氏名を入力してください").max(50),
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません"),
  role: z.enum(["MEMBER", "ADMIN"]),
  department: z.string().trim().max(50).optional(),
});

export async function saveEmployee(fd: FormData) {
  const admin = await requireAdmin();
  const parsed = EmployeeInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) back("/admin/employees", "err", parsed.error.issues[0].message);
  const v = parsed.data;
  const domain = (process.env.ALLOWED_DOMAIN ?? "").toLowerCase();
  if (domain && !v.email.endsWith(`@${domain}`)) back("/admin/employees", "err", `@${domain} のアドレスを入力してください。`);

  const id = String(fd.get("id") ?? "");
  if (id) {
    const cur = await db.query.employees.findFirst({ where: eq(t.employees.id, id) });
    if (!cur) back("/admin/employees", "err", "社員が見つかりません。");
    if (cur.id === admin.id && v.role !== "ADMIN") back("/admin/employees", "err", "自分自身の管理者権限は外せません。");
    const dup = await db.query.employees.findFirst({ where: eq(t.employees.email, v.email) });
    if (dup && dup.id !== id) back("/admin/employees", "err", "このメールアドレスはすでに登録されています。");
    await db.transaction(async (tx) => {
      await tx.update(t.employees).set({ name: v.name, email: v.email, role: v.role, department: v.department || null }).where(eq(t.employees.id, id));
      await logChange(tx, { table: "employees", id, by: admin.id, before: { name: cur.name, email: cur.email, role: cur.role }, after: v });
    });
    refresh();
    back("/admin/employees", "msg", "社員情報を更新しました。");
  }
  const dup = await db.query.employees.findFirst({ where: eq(t.employees.email, v.email) });
  if (dup) back("/admin/employees", "err", "このメールアドレスはすでに登録されています。");
  const [created] = await db.insert(t.employees).values({ ...v, department: v.department || null }).returning();
  await logChange(db, { table: "employees", id: created.id, by: admin.id, after: v, reason: "新規登録" });
  refresh();
  back("/admin/employees", "msg", `${v.name}さんを登録しました。続けて給与マスタを登録してください。`);
}

export async function setEmployeeActive(fd: FormData) {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const active = fd.get("active") === "1";
  if (id === admin.id && !active) back("/admin/employees", "err", "自分自身は退職扱いにできません。");
  await db
    .update(t.employees)
    .set({ isActive: active, leftOn: active ? null : new Date().toISOString().slice(0, 10) })
    .where(eq(t.employees.id, id));
  await logChange(db, { table: "employees", id, by: admin.id, after: { isActive: active }, reason: active ? "復職" : "退職" });
  refresh();
  back("/admin/employees", "msg", active ? "在籍に戻しました。" : "退職扱いにしました（過去の記録は残ります）。");
}

const SalaryInput = z
  .object({
    employeeId: z.string().min(1),
    payType: z.enum(["MONTHLY", "HOURLY"]),
    basePay: z.coerce.number().int().min(0).max(10_000_000).default(0),
    includedAllowances: z.coerce.number().int().min(0).max(10_000_000).default(0),
    hourlyWage: z.coerce.number().int().min(0).max(100_000).optional(),
    effectiveFrom: z.string().regex(ymdRe, "適用開始日を入力してください"),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.payType === "MONTHLY" || (v.hourlyWage ?? 0) > 0, { message: "時給を入力してください" })
  .refine((v) => v.payType === "HOURLY" || v.basePay > 0, { message: "基本給を入力してください" });

export async function saveSalary(fd: FormData) {
  const admin = await requireAdmin();
  const raw = Object.fromEntries(fd);
  const to = `/admin/salary?e=${encodeURIComponent(String(raw.employeeId ?? ""))}`;
  const parsed = SalaryInput.safeParse(raw);
  if (!parsed.success) back(to, "err", parsed.error.issues[0].message);
  const v = parsed.data;

  // 確定済みの月に遡る改定は、その月の金額が変わらないよう確認の対象にする
  if (await isMonthClosed(ymOf(v.effectiveFrom))) {
    back(to, "err", "確定済みの月から始まる改定は登録できません。確定済みの金額は変更されないため、翌月以降の日付にしてください。");
  }
  const [row] = await db
    .insert(t.salaries)
    .values({
      employeeId: v.employeeId,
      payType: v.payType,
      basePay: v.payType === "MONTHLY" ? v.basePay : 0,
      includedAllowances: v.payType === "MONTHLY" ? v.includedAllowances : 0,
      hourlyWage: v.payType === "HOURLY" ? v.hourlyWage : null,
      effectiveFrom: v.effectiveFrom,
      note: v.note || null,
    })
    .returning();
  await logChange(db, { table: "salaries", id: row.id, by: admin.id, after: row, reason: "給与マスタの追加・改定" });
  refresh();
  back(to, "msg", "給与マスタを保存しました。");
}

/* ---------- システム設定 ---------- */

const SettingsInput = z.object({
  dailyHours: z.coerce.number().min(1).max(8),
  annualHolidays: z.coerce.number().int().min(0).max(200),
  legalHolidayWeekday: z.coerce.number().int().min(0).max(6),
  limitMonthHours: z.coerce.number().min(1).max(100),
  limitYearHours: z.coerce.number().min(1).max(720),
  agreementStartMonth: z.coerce.number().int().min(1).max(12),
  warnPercent: z.coerce.number().int().min(10).max(100),
});

export async function saveSettings(fd: FormData) {
  const admin = await requireAdmin();
  const parsed = SettingsInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) back("/admin/settings", "err", "入力値を確認してください（所定労働時間は8時間以内など）。");
  const v = parsed.data;
  const company = fd.getAll("companyWeekday").map(Number).filter((n) => n >= 0 && n <= 6 && n !== v.legalHolidayWeekday);
  const values = {
    dailyMinutes: Math.round(v.dailyHours * 60),
    annualHolidays: v.annualHolidays,
    legalHolidayWeekday: v.legalHolidayWeekday,
    companyHolidayWeekdays: company.join(","),
    premiumForInner: fd.get("premiumForInner") === "on",
    limitMonthMinutes: Math.round(v.limitMonthHours * 60),
    limitYearMinutes: Math.round(v.limitYearHours * 60),
    agreementStartMonth: v.agreementStartMonth,
    warnPercent: v.warnPercent,
  };
  const before = await getSettings();
  await db.update(t.settings).set(values).where(eq(t.settings.id, 1));
  await logChange(db, { table: "settings", id: "1", by: admin.id, before, after: values });
  refresh();
  back("/admin/settings", "msg", "設定を保存しました。確定前の月の金額から新しい設定で計算されます。");
}

export async function addHoliday(fd: FormData) {
  await requireAdmin();
  const date = String(fd.get("date") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const isLegal = fd.get("isLegal") === "on";
  if (!ymdRe.test(date) || !name) back("/admin/settings", "err", "日付と名称を入力してください。");
  await db.insert(t.holidays).values({ date, name, isLegal }).onConflictDoUpdate({ target: t.holidays.date, set: { name, isLegal } });
  refresh();
  back("/admin/settings", "msg", "休日を登録しました。");
}

export async function deleteHolidays(fd: FormData) {
  await requireAdmin();
  const dates = fd.getAll("dates").map(String).filter((d) => ymdRe.test(d));
  if (dates.length === 0) back("/admin/settings", "err", "削除する休日を選んでください。");
  await db.delete(t.holidays).where(inArray(t.holidays.date, dates));
  refresh();
  back("/admin/settings", "msg", `${dates.length}件を削除しました。`);
}
