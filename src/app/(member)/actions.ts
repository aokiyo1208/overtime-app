"use server";

import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { overtimeRequests, timeRecords } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { isMonthClosed } from "@/lib/payroll";
import { excessMinutes } from "@/lib/overtime";
import { jstDateTime, todayYmd, ymOf } from "@/lib/time";
import { logChange } from "@/lib/audit";
import { lockMonth, lockEmployee, lockedRequest, monthClosed } from "@/lib/work-lock";
import { activeTimeRecord } from "@/lib/time-record";
import { pendingCorrection } from "@/lib/corrections";

function back(path: string, kind: "msg" | "err", text: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(text)}`);
}

const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
const hmRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const RequestInput = z.object({
  workDate: z.string().regex(ymdRe, "対象日を選んでください"),
  start: z.string().regex(hmRe, "予定開始を入力してください"),
  end: z.string().regex(hmRe, "予定終了を入力してください"),
  task: z.string().trim().min(1, "業務内容を入力してください").max(200, "業務内容は200文字以内にしてください"),
  reason: z.string().trim().min(1, "理由を入力してください").max(500, "理由は500文字以内にしてください"),
});

export async function createRequest(fd: FormData) {
  const me = await requireUser();
  const parsed = RequestInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) back("/request", "err", parsed.error.issues[0].message);
  const { workDate, start, end, task, reason } = parsed.data;

  if (await isMonthClosed(ymOf(workDate))) back("/request", "err", "この月は締め済みのため申請できません。管理者に連絡してください。");

  const plannedStart = jstDateTime(workDate, start);
  let plannedEnd = jstDateTime(workDate, end);
  if (plannedEnd <= plannedStart) plannedEnd = new Date(plannedEnd.getTime() + 24 * 3600_000); // 日またぎ
  if (plannedEnd.getTime() - plannedStart.getTime() > 16 * 3600_000) back("/request", "err", "1回の申請は16時間以内にしてください。");

  await db.transaction(async (tx) => {
    await lockMonth(tx, ymOf(workDate));
    await lockEmployee(tx, me.id);
    if (await monthClosed(tx, workDate)) back("/request", "err", "この月は締め済みのため申請できません。管理者に連絡してください。");
  const overlap = await tx.query.overtimeRequests.findFirst({
    where: and(
      eq(overtimeRequests.employeeId, me.id),
      inArray(overtimeRequests.status, ["PENDING", "APPROVED"]),
      lt(overtimeRequests.plannedStart, plannedEnd),
      gt(overtimeRequests.plannedEnd, plannedStart),
    ),
  });
  if (overlap) back("/request", "err", "同じ時間帯の申請がすでにあります。");

  await tx.insert(overtimeRequests).values({
    employeeId: me.id,
    workDate,
    plannedStart,
    plannedEnd,
    task,
    reason,
    isAfterTheFact: new Date() > plannedStart,
  });
  });
  revalidatePath("/", "layout");
  back("/history", "msg", "申請しました。承認されると通知が届きます。");
}

export async function cancelRequest(fd: FormData) {
  const me = await requireUser();
  const id = String(fd.get("id") ?? "");
  await db.transaction(async (tx) => {
    const req = await lockedRequest(tx, id);
    const rec = activeTimeRecord(await tx.query.timeRecords.findFirst({ where: eq(timeRecords.requestId, id) }));
    if (!req || req.employeeId !== me.id || req.status !== "PENDING" || rec) back("/history", "err", "取り消せるのは、打刻前の申請中のものだけです。");
    if (await monthClosed(tx, req.workDate)) back("/history", "err", "この月は締め済みです。");
    if (await pendingCorrection(tx, id)) back("/history", "err", "打刻修正の承認待ちです。修正申請を先に取り消してください。");
    await tx.update(overtimeRequests).set({ status: "CANCELED" }).where(eq(overtimeRequests.id, id));
    await logChange(tx, { table: "overtime_requests", id, by: me.id, before: { status: req.status }, after: { status: "CANCELED" }, reason: "本人が取消" });
  });
  revalidatePath("/", "layout");
  back("/history", "msg", "申請を取り消しました。");
}

export async function startStamp(fd: FormData) {
  const me = await requireUser();
  await db.transaction(async (tx) => {
    const req = await lockedRequest(tx, String(fd.get("id") ?? ""));
    if (!req || req.employeeId !== me.id) back("/", "err", "申請が見つかりません。");
    if (req.status !== "APPROVED" && req.status !== "PENDING") back("/", "err", "却下・取消された申請では打刻できません。");
    const stored = await tx.query.timeRecords.findFirst({ where: eq(timeRecords.requestId, req.id) });
    if (activeTimeRecord(stored)) back("/", "err", "すでに開始の打刻があります。");
    if (req.workDate !== todayYmd()) back("/", "err", "打刻できるのは対象日当日の申請だけです。");
    if (await monthClosed(tx, req.workDate)) back("/", "err", "この月は締め済みです。");
    if (await pendingCorrection(tx, req.id)) back("/", "err", "打刻修正の承認待ちです。打刻する場合は修正申請を先に取り消してください。");
    const startedAt = new Date();
    if (stored) {
      const values = { startedAt, endedAt: null, breakMinutes: 0, excessStatus: "NONE" as const, correctionRequest: null, corrected: false, voidedAt: null };
      await tx.update(timeRecords).set(values).where(eq(timeRecords.id, stored.id));
      await logChange(tx, { table: "time_records", id: stored.id, by: me.id, before: stored, after: values, reason: "開始打刻の取消後に再打刻" });
    } else {
      await tx.insert(timeRecords).values({ requestId: req.id, employeeId: me.id, startedAt }).onConflictDoNothing();
    }
  });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function endStamp(fd: FormData) {
  const me = await requireUser();
  const breakMinutes = Math.max(0, Math.min(600, Math.floor(Number(fd.get("breakMinutes") ?? 0) || 0)));
  const excess = await db.transaction(async (tx) => {
    const req = await lockedRequest(tx, String(fd.get("id") ?? ""));
    if (!req || req.employeeId !== me.id) back("/", "err", "申請が見つかりません。");
    if (req.status !== "APPROVED" && req.status !== "PENDING") back("/", "err", "却下・取消された申請では打刻できません。");
    if (await monthClosed(tx, req.workDate)) back("/", "err", "この月は締め済みです。");
    if (await pendingCorrection(tx, req.id)) back("/", "err", "打刻修正の承認待ちです。打刻する場合は修正申請を先に取り消してください。");
    const rec = activeTimeRecord(await tx.query.timeRecords.findFirst({ where: eq(timeRecords.requestId, req.id) }));
    if (!rec) back("/", "err", "開始の打刻がありません。");
    if (rec.endedAt) back("/", "err", "すでに終了の打刻があります。");
    const endedAt = new Date();
    const excess = excessMinutes({ start: req.plannedStart, end: req.plannedEnd }, { start: rec.startedAt, end: endedAt });
    await tx.update(timeRecords).set({ endedAt, breakMinutes, excessStatus: excess > 0 ? "PENDING" : "NONE" }).where(eq(timeRecords.id, rec.id));
    return excess;
  });
  revalidatePath("/", "layout");
  back("/", "msg", excess > 0 ? "終了を打刻しました。予定を超えた分は管理者の承認後に計上されます。" : "終了を打刻しました。");
}

/** 古い画面からの投稿は、新しい申請画面へ案内する。 */
export async function requestCorrection(fd: FormData) {
  const me = await requireUser();
  const rec = await db.query.timeRecords.findFirst({ where: and(eq(timeRecords.id, String(fd.get("recordId") ?? "")), eq(timeRecords.employeeId, me.id)) });
  if (!rec || !activeTimeRecord(rec)) back("/history", "err", "打刻が見つかりません。");
  redirect(`/corrections/${encodeURIComponent(rec.requestId)}`);
}
