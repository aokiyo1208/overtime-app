import { and, eq, gt, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { employees, overtimeRequests, timeCorrectionRequests, timeRecords } from "@/db/schema";
import type { DB, Tx } from "./db";
import { logChange } from "./audit";
import { CorrectionError, recordSnapshot, snapshotMatches, validateCancellationReason, validateCorrection } from "./correction-validation";
import { activeTimeRecord } from "./time-record";
import { lockedRequest, monthClosed } from "./work-lock";
async function actor(tx: Tx, employeeId: string, admin = false) {
  const person = await tx.query.employees.findFirst({ where: eq(employees.id, employeeId) });
  if (!person?.isActive || (admin && person.role !== "ADMIN")) throw new CorrectionError("この操作を行う権限がありません。");
  return person;
}
export async function pendingCorrection(tx: Tx, requestId: string) {
  return tx.query.timeCorrectionRequests.findFirst({ where: and(eq(timeCorrectionRequests.requestId, requestId), eq(timeCorrectionRequests.status, "PENDING")) });
}
async function ensureNoOverlap(tx: Tx, employeeId: string, requestId: string, start: Date, end: Date) {
  const overlap = await tx.select({ id: timeRecords.id }).from(timeRecords)
    .innerJoin(overtimeRequests, eq(overtimeRequests.id, timeRecords.requestId))
    .where(and(eq(timeRecords.employeeId, employeeId), ne(timeRecords.requestId, requestId),
      inArray(overtimeRequests.status, ["PENDING", "APPROVED"]), isNull(timeRecords.voidedAt),
      lt(timeRecords.startedAt, end), or(gt(timeRecords.endedAt, start), and(isNull(timeRecords.endedAt), gte(timeRecords.startedAt, start))),
    )).limit(1);
  if (overlap.length) throw new CorrectionError("同じ時間帯に別の打刻があります。管理者に確認してください。");
}
export async function createCorrection(database: DB, employeeId: string, requestId: string, input: unknown, now = new Date()) {
  return database.transaction(async tx => {
    await actor(tx, employeeId);
    const request = await lockedRequest(tx, requestId);
    if (!request || request.employeeId !== employeeId) throw new CorrectionError("申請が見つかりません。");
    if (!["PENDING", "APPROVED"].includes(request.status)) throw new CorrectionError("却下・取消された残業申請は修正できません。");
    if (await monthClosed(tx, request.workDate)) throw new CorrectionError("この月は確定済みです。管理者に連絡してください。");
    if (await pendingCorrection(tx, requestId)) throw new CorrectionError("すでに修正申請中です。変更する場合は取り消してから再申請してください。");
    const current = activeTimeRecord(await tx.query.timeRecords.findFirst({ where: eq(timeRecords.requestId, requestId) }));
    if (current?.correctionRequest) throw new CorrectionError("以前の修正依頼が対応待ちです。管理者に確認してください。");
    const proposed = validateCorrection(input, request.workDate, now);
    if (current?.endedAt && proposed.startedAt.getTime() === current.startedAt.getTime() && proposed.endedAt.getTime() === current.endedAt.getTime() && proposed.breakMinutes === current.breakMinutes) throw new CorrectionError("現在の打刻と同じ内容です。修正する日時や休憩時間を確認してください。");
    await ensureNoOverlap(tx, employeeId, requestId, proposed.startedAt, proposed.endedAt);
    const [created] = await tx.insert(timeCorrectionRequests).values({ kind: "CORRECT", requestId, employeeId, ...recordSnapshot(current), proposedStartedAt: proposed.startedAt, proposedEndedAt: proposed.endedAt, proposedBreakMinutes: proposed.breakMinutes, reason: proposed.reason }).returning();
    await logChange(tx, { table: "time_correction_requests", id: created.id, by: employeeId, after: created, reason: "打刻修正を申請" });
    return created;
  });
}
/** まだ終了していない誤った開始打刻を、承認後に未打刻へ戻す申請。 */
export async function createStartCancellation(database: DB, employeeId: string, requestId: string, input: unknown) {
  return database.transaction(async tx => {
    await actor(tx, employeeId);
    const request = await lockedRequest(tx, requestId);
    if (!request || request.employeeId !== employeeId) throw new CorrectionError("申請が見つかりません。");
    if (!["PENDING", "APPROVED"].includes(request.status)) throw new CorrectionError("却下・取消された残業申請では打刻を取り消せません。");
    if (await monthClosed(tx, request.workDate)) throw new CorrectionError("この月は確定済みです。管理者に連絡してください。");
    if (await pendingCorrection(tx, requestId)) throw new CorrectionError("すでに打刻の変更を申請中です。変更する場合は取り消してから再申請してください。");
    const current = activeTimeRecord(await tx.query.timeRecords.findFirst({ where: eq(timeRecords.requestId, requestId) }));
    if (!current || current.endedAt) throw new CorrectionError("取り消せるのは終了前の開始打刻だけです。");
    if (current.correctionRequest) throw new CorrectionError("以前の修正依頼が対応待ちです。管理者に確認してください。");
    const reason = validateCancellationReason(input);
    const [created] = await tx.insert(timeCorrectionRequests).values({ kind: "VOID_START", requestId, employeeId, ...recordSnapshot(current), proposedStartedAt: null, proposedEndedAt: null, proposedBreakMinutes: null, reason }).returning();
    await logChange(tx, { table: "time_correction_requests", id: created.id, by: employeeId, after: created, reason: "誤った開始打刻の取消を申請" });
    return created;
  });
}
export async function decideCorrection(database: DB, reviewerId: string, correctionId: string, approve: boolean, comment?: string) {
  return database.transaction(async tx => {
    await actor(tx, reviewerId, true);
    const found = await tx.query.timeCorrectionRequests.findFirst({ where: eq(timeCorrectionRequests.id, correctionId) });
    if (!found) throw new CorrectionError("修正申請が見つかりません。");
    const request = await lockedRequest(tx, found.requestId);
    const correction = await tx.query.timeCorrectionRequests.findFirst({ where: eq(timeCorrectionRequests.id, correctionId) });
    if (!request || !correction || correction.status !== "PENDING") throw new CorrectionError("すでに処理済みの修正申請です。");
    if (await monthClosed(tx, request.workDate)) throw new CorrectionError("月次確定済みのため処理できません。確定を解除してください。");
    const rejection = comment?.trim();
    if (!approve && (!rejection || rejection.length > 500)) throw new CorrectionError("却下理由を1〜500文字で入力してください。");
    const decidedAt = new Date();
    if (approve) {
      if (!["PENDING", "APPROVED"].includes(request.status)) throw new CorrectionError("元の残業申請が却下・取消されています。修正申請を却下してください。");
      const stored = await tx.query.timeRecords.findFirst({ where: eq(timeRecords.requestId, request.id) });
      const current = activeTimeRecord(stored);
      if (!snapshotMatches(correction, current)) throw new CorrectionError("申請後に打刻が変更されています。内容を確認して却下し、本人に再申請を依頼してください。");
      if (correction.kind === "VOID_START") {
        if (!current || current.endedAt) throw new CorrectionError("取り消せるのは終了前の開始打刻だけです。");
        const [voided] = await tx.update(timeRecords).set({ voidedAt: decidedAt, corrected: true }).where(eq(timeRecords.id, current.id)).returning();
        await logChange(tx, { table: "time_records", id: current.id, by: reviewerId, before: current, after: { ...voided, correctionId }, reason: correction.reason });
      } else {
        if (!correction.proposedStartedAt || !correction.proposedEndedAt || correction.proposedBreakMinutes === null) throw new CorrectionError("修正内容が正しくありません。本人に再申請を依頼してください。");
        await ensureNoOverlap(tx, request.employeeId, request.id, correction.proposedStartedAt, correction.proposedEndedAt);
        const exceeds = correction.proposedStartedAt < request.plannedStart || correction.proposedEndedAt > request.plannedEnd;
        const previouslyCovered = current?.excessStatus === "APPROVED" && current.endedAt && correction.proposedStartedAt >= current.startedAt && correction.proposedEndedAt <= current.endedAt;
        const values = { startedAt: correction.proposedStartedAt, endedAt: correction.proposedEndedAt, breakMinutes: correction.proposedBreakMinutes, corrected: true, correctionRequest: null, voidedAt: null, excessStatus: (exceeds ? (previouslyCovered ? "APPROVED" : "PENDING") : "NONE") as "APPROVED" | "PENDING" | "NONE" };
        const [record] = stored ? await tx.update(timeRecords).set(values).where(eq(timeRecords.id, stored.id)).returning() : await tx.insert(timeRecords).values({ ...values, requestId: request.id, employeeId: request.employeeId }).returning();
        await logChange(tx, { table: "time_records", id: record.id, by: reviewerId, before: current ? { startedAt: current.startedAt, endedAt: current.endedAt, breakMinutes: current.breakMinutes, excessStatus: current.excessStatus } : null, after: { ...values, correctionId }, reason: correction.reason });
      }
    }
    const status = approve ? "APPROVED" : "REJECTED";
    await tx.update(timeCorrectionRequests).set({ status, reviewerId, decidedAt, rejectComment: approve ? null : rejection }).where(eq(timeCorrectionRequests.id, correctionId));
    await logChange(tx, { table: "time_correction_requests", id: correctionId, by: reviewerId, before: { status: "PENDING" }, after: { status, reviewerId, decidedAt, rejectComment: approve ? null : rejection }, reason: approve ? (correction.kind === "VOID_START" ? "開始打刻の取消を承認して反映" : "打刻修正を承認して反映") : rejection });
    return { requestId: request.id, kind: correction.kind };
  });
}
export async function withdrawCorrection(database: DB, employeeId: string, correctionId: string) {
  return database.transaction(async tx => {
    await actor(tx, employeeId);
    const found = await tx.query.timeCorrectionRequests.findFirst({ where: and(eq(timeCorrectionRequests.id, correctionId), eq(timeCorrectionRequests.employeeId, employeeId)) });
    if (!found) throw new CorrectionError("修正申請が見つかりません。");
    const request = await lockedRequest(tx, found.requestId);
    if (!request || await monthClosed(tx, request.workDate)) throw new CorrectionError("この月は確定済みのため、修正申請を取り消せません。");
    const current = await tx.query.timeCorrectionRequests.findFirst({ where: eq(timeCorrectionRequests.id, correctionId) });
    if (current?.status !== "PENDING") throw new CorrectionError("すでに処理済みの修正申請です。");
    const decidedAt = new Date();
    await tx.update(timeCorrectionRequests).set({ status: "CANCELED", decidedAt }).where(eq(timeCorrectionRequests.id, correctionId));
    await logChange(tx, { table: "time_correction_requests", id: correctionId, by: employeeId, before: { status: "PENDING" }, after: { status: "CANCELED", decidedAt }, reason: "本人が修正申請を取消" });
    return { requestId: found.requestId };
  });
}
