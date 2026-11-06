import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
const user = vi.hoisted(() => ({ id: "member" }));
vi.mock("@/lib/session", () => ({ requireAdmin: async () => ({ id: "admin" }), requireUser: async () => ({ id: user.id }) }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
import { db } from "./db";
import * as t from "@/db/schema";
import { createCorrection, createStartCancellation, decideCorrection, withdrawCorrection } from "./corrections";
import { computeEmployeeMonth } from "./payroll";
import { closeMonth, reopenMonth, correctRecord, cancelApproved, decideExcess, rejectRequest } from "@/app/admin/actions";
import { startStamp, endStamp, cancelRequest } from "@/app/(member)/actions";
import { activeTimeRecord } from "./time-record";
import { jstDateTime, todayYmd } from "./time";

const enabled = process.env.CLOCK_INTEGRATION === "1";
const date = "2026-10-06";
const at = (hm: string, day = date) => jstDateTime(day, hm);
const input = (extra: Record<string, unknown> = {}) => ({ startDate: date, start: "18:00", endDate: date, end: "20:00", breakMinutes: "0", reason: "打刻を忘れたため", ...extra });
const fd = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
const actual = () => db.query.timeRecords.findFirst({ where: eq(t.timeRecords.requestId, "req") });
const history = () => db.query.timeCorrectionRequests.findMany({ where: eq(t.timeCorrectionRequests.requestId, "req") });
async function addRecord(values: Partial<typeof t.timeRecords.$inferInsert> = {}) {
  return (await db.insert(t.timeRecords).values({ requestId: "req", employeeId: "member", startedAt: at("18:00"), ...values }).returning())[0];
}
async function addOther(start: Date, end: Date | null) {
  await db.insert(t.overtimeRequests).values({ id: "other-req", employeeId: "member", workDate: date, plannedStart: start, plannedEnd: end ?? new Date(start.getTime() + 3600000), task: "別の残業", reason: "検証", status: "APPROVED" });
  await db.insert(t.timeRecords).values({ id: "other-rec", requestId: "other-req", employeeId: "member", startedAt: start, endedAt: end });
}
async function redirected(action: () => Promise<unknown>) {
  try { await action(); throw new Error("Expected redirect"); }
  catch (error) { const msg = String(error); if (!msg.includes("REDIRECT:")) throw error; return decodeURIComponent(msg); }
}

describe.skipIf(!enabled)("clock correction integration (disposable loopback PostgreSQL only)", () => {
  beforeAll(() => {
    const u = new URL(process.env.DATABASE_URL ?? "");
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.pathname !== "/clock_correction_test") throw new Error("Refusing non-isolated database");
  });
  beforeEach(async () => {
    user.id = "member";
    await db.execute(sql`truncate table time_correction_requests, change_logs, time_records, monthly_summaries, monthly_closes, overtime_requests, salaries, employees, settings, holidays cascade`);
    await db.insert(t.employees).values([{ id: "member", name: "検証社員", email: "member@example.com" }, { id: "other", name: "別社員", email: "other@example.com" }, { id: "admin", name: "検証管理者", email: "admin@example.com", role: "ADMIN" }]);
    await db.insert(t.settings).values({ id: 1 });
    await db.insert(t.salaries).values({ employeeId: "member", payType: "MONTHLY", basePay: 320000, effectiveFrom: "2026-01-01" });
    await db.insert(t.overtimeRequests).values({ id: "req", employeeId: "member", workDate: date, plannedStart: at("18:00"), plannedEnd: at("20:00"), task: "書類作成", reason: "検証", status: "APPROVED" });
  });
  afterAll(async () => { const g = globalThis as unknown as { pool?: { end(): Promise<void> } }; await g.pool?.end(); });

  it("submits missing-both without creating actual timestamps", async () => {
    const c = await createCorrection(db, "member", "req", input());
    expect(c.status).toBe("PENDING"); expect(c.originalRecordId).toBeNull(); expect(await actual()).toBeUndefined();
    expect(await db.query.changeLogs.findMany()).toHaveLength(1);
  });
  it("approves exactly requested values with decision and before/after audit", async () => {
    const c = await createCorrection(db, "member", "req", input({ breakMinutes: "15" }));
    await decideCorrection(db, "admin", c.id, true);
    expect(await actual()).toMatchObject({ startedAt: at("18:00"), endedAt: at("20:00"), breakMinutes: 15, corrected: true });
    expect((await history())[0]).toMatchObject({ status: "APPROVED", reviewerId: "admin" });
    expect(await db.query.changeLogs.findMany()).toHaveLength(3);
  });
  it("never approves the underlying overtime or counts pending overtime as payable", async () => {
    await db.update(t.overtimeRequests).set({ status: "PENDING" }).where(eq(t.overtimeRequests.id, "req"));
    const c = await createCorrection(db, "member", "req", input()); await decideCorrection(db, "admin", c.id, true);
    expect((await db.query.overtimeRequests.findFirst({ where: eq(t.overtimeRequests.id, "req") }))?.status).toBe("PENDING");
    const result = await computeEmployeeMonth({ id: "member", name: "検証", email: "member@example.com" }, "2026-10");
    expect(result.totals.statutoryMinutes).toBe(0);
  });
  it("repairs missing end while retaining original snapshot", async () => {
    const r = await addRecord(); const c = await createCorrection(db, "member", "req", input());
    expect(c.originalRecordId).toBe(r.id); expect(c.originalEndedAt).toBeNull();
    await decideCorrection(db, "admin", c.id, true); expect((await actual())?.id).toBe(r.id);
  });
  it("repairs late start", async () => {
    await addRecord({ startedAt: at("19:00"), endedAt: at("20:00") }); const c = await createCorrection(db, "member", "req", input());
    await decideCorrection(db, "admin", c.id, true); expect((await actual())?.startedAt).toEqual(at("18:00"));
  });
  it("supports explicitly dated overnight end", async () => {
    const c = await createCorrection(db, "member", "req", input({ start: "23:00", endDate: "2026-10-07", end: "02:00" }));
    await decideCorrection(db, "admin", c.id, true); expect((await actual())?.endedAt).toEqual(at("02:00", "2026-10-07"));
  });
  it("allows only one concurrent pending request", async () => {
    const results = await Promise.allSettled([createCorrection(db, "member", "req", input()), createCorrection(db, "member", "req", input())]);
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(await history()).toHaveLength(1);
  });
  it("applies concurrent approval only once", async () => {
    const c = await createCorrection(db, "member", "req", input()); const results = await Promise.allSettled([decideCorrection(db, "admin", c.id, true), decideCorrection(db, "admin", c.id, true)]);
    expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(await db.query.timeRecords.findMany()).toHaveLength(1); expect(await db.query.changeLogs.findMany()).toHaveLength(3);
  });
  it("rejects other employee submission", async () => { await expect(createCorrection(db, "other", "req", input())).rejects.toThrow("見つかりません"); });
  it("rejects non-admin decision", async () => { const c = await createCorrection(db, "member", "req", input()); await expect(decideCorrection(db, "other", c.id, true)).rejects.toThrow("権限"); });
  it("rejects inactive submitter", async () => { await db.update(t.employees).set({ isActive: false }).where(eq(t.employees.id, "member")); await expect(createCorrection(db, "member", "req", input())).rejects.toThrow("権限"); });
  it("rejects inactive reviewer", async () => { const c = await createCorrection(db, "member", "req", input()); await db.update(t.employees).set({ isActive: false }).where(eq(t.employees.id, "admin")); await expect(decideCorrection(db, "admin", c.id, true)).rejects.toThrow("権限"); });
  it.each(["REJECTED", "CANCELED"] as const)("rejects %s underlying request", async status => { await db.update(t.overtimeRequests).set({ status }).where(eq(t.overtimeRequests.id, "req")); await expect(createCorrection(db, "member", "req", input())).rejects.toThrow("修正できません"); });
  it("requires rejection reason and leaves pending state on invalid input", async () => {
    const c = await createCorrection(db, "member", "req", input());
    for (const reason of ["", " ", "a".repeat(501)]) await expect(decideCorrection(db, "admin", c.id, false, reason)).rejects.toThrow("却下理由");
    expect((await history())[0].status).toBe("PENDING");
  });
  it("rejection retains original actual data and reason", async () => {
    const r = await addRecord(); const c = await createCorrection(db, "member", "req", input()); await decideCorrection(db, "admin", c.id, false, " 内容を確認してください ");
    expect(await actual()).toEqual(r); expect((await history())[0]).toMatchObject({ status: "REJECTED", rejectComment: "内容を確認してください" });
  });
  it("withdraws own request without timestamp changes and allows new request", async () => {
    const c = await createCorrection(db, "member", "req", input()); await withdrawCorrection(db, "member", c.id); const next = await createCorrection(db, "member", "req", input());
    expect(next.id).not.toBe(c.id); expect(await history()).toHaveLength(2); expect(await actual()).toBeUndefined();
  });
  it("rejects another employee withdrawal", async () => { const c = await createCorrection(db, "member", "req", input()); await expect(withdrawCorrection(db, "other", c.id)).rejects.toThrow("見つかりません"); });
  it("rejects stale actual snapshot", async () => {
    await addRecord(); const c = await createCorrection(db, "member", "req", input()); await db.update(t.timeRecords).set({ breakMinutes: 10 }).where(eq(t.timeRecords.requestId, "req"));
    await expect(decideCorrection(db, "admin", c.id, true)).rejects.toThrow("申請後"); expect((await history())[0].status).toBe("PENDING");
  });
  it("rejects a newly inserted actual record since missing-both submission", async () => { const c = await createCorrection(db, "member", "req", input()); await addRecord(); await expect(decideCorrection(db, "admin", c.id, true)).rejects.toThrow("申請後"); });
  it("rejects overlap with completed other actual interval", async () => { await addOther(at("19:00"), at("21:00")); await expect(createCorrection(db, "member", "req", input())).rejects.toThrow("同じ時間帯"); });
  it("rejects open-ended other punch starting inside proposed interval", async () => { await addOther(at("19:00"), null); await expect(createCorrection(db, "member", "req", input())).rejects.toThrow("同じ時間帯"); });
  it("does not treat an old missing-end punch as an infinite interval", async () => { await addOther(at("18:00", "2026-10-05"), null); expect((await createCorrection(db, "member", "req", input())).status).toBe("PENDING"); });
  it("rechecks overlap during approval", async () => { const c = await createCorrection(db, "member", "req", input()); await addOther(at("19:00"), at("21:00")); await expect(decideCorrection(db, "admin", c.id, true)).rejects.toThrow("同じ時間帯"); });
  it("blocks submission/approval/withdrawal in a closed month", async () => {
    const c = await createCorrection(db, "member", "req", input()); await db.insert(t.monthlyCloses).values({ yearMonth: "2026-10", closedById: "admin" });
    await expect(createCorrection(db, "member", "req", input())).rejects.toThrow("確定済み"); await expect(decideCorrection(db, "admin", c.id, true)).rejects.toThrow("確定済み"); await expect(withdrawCorrection(db, "member", c.id)).rejects.toThrow("確定済み");
  });
  it("requires fresh excess approval when expanding an approved interval", async () => {
    await addRecord({ startedAt: at("17:00"), endedAt: at("21:00"), excessStatus: "APPROVED" }); const c = await createCorrection(db, "member", "req", input({ start: "16:00", end: "21:00" })); await decideCorrection(db, "admin", c.id, true); expect((await actual())?.excessStatus).toBe("PENDING");
  });
  it("preserves excess approval only inside previously covered interval", async () => {
    await addRecord({ startedAt: at("16:00"), endedAt: at("22:00"), excessStatus: "APPROVED" }); const c = await createCorrection(db, "member", "req", input({ start: "17:00", end: "21:00" })); await decideCorrection(db, "admin", c.id, true); expect((await actual())?.excessStatus).toBe("APPROVED");
  });
  it("clears excess status when correction is fully inside plan", async () => {
    await addRecord({ startedAt: at("17:00"), endedAt: at("21:00"), excessStatus: "APPROVED" }); const c = await createCorrection(db, "member", "req", input()); await decideCorrection(db, "admin", c.id, true); expect((await actual())?.excessStatus).toBe("NONE");
  });
  it("blocks monthly close while correction is pending", async () => { await createCorrection(db, "member", "req", input()); expect(await redirected(() => closeMonth(fd({ ym: "2026-10" })))).toContain("打刻修正の承認待ち"); expect(await db.query.monthlyCloses.findMany()).toHaveLength(0); });
  it("blocks legacy correction duplication and month close", async () => { await addRecord({ correctionRequest: "旧依頼", endedAt: at("20:00"), corrected: true }); await expect(createCorrection(db, "member", "req", input({ end: "20:30" }))).rejects.toThrow("以前の修正"); expect(await redirected(() => closeMonth(fd({ ym: "2026-10" })))).toContain("以前の打刻修正依頼"); });
  it("blocks direct admin correction while structured approval is pending", async () => { const r = await addRecord(); await createCorrection(db, "member", "req", input()); expect(await redirected(() => correctRecord(fd({ recordId: r.id, start: "18:00", end: "21:00", reason: "手修正" })))).toContain("打刻修正の承認待ち"); expect((await actual())?.endedAt).toBeNull(); });
  it("blocks underlying cancellation while correction is pending", async () => { await createCorrection(db, "member", "req", input()); expect(await redirected(() => cancelApproved(fd({ id: "req", reason: "取消" })))).toContain("打刻修正の承認待ち"); });
  it("blocks excess decision while correction is pending", async () => { const r = await addRecord({ endedAt: at("21:00"), excessStatus: "PENDING" }); await createCorrection(db, "member", "req", input()); expect(await redirected(() => decideExcess(fd({ recordId: r.id, approve: "1" })))).toContain("打刻修正の承認待ち"); });
  it("blocks ordinary end stamp while correction is pending", async () => { await addRecord(); await createCorrection(db, "member", "req", input()); expect(await redirected(() => endStamp(fd({ id: "req" })))).toContain("打刻修正の承認待ち"); });
  it("blocks overtime rejection and own cancellation while correction is pending", async () => {
    await db.update(t.overtimeRequests).set({ status: "PENDING" }).where(eq(t.overtimeRequests.id, "req")); await createCorrection(db, "member", "req", input());
    expect(await redirected(() => rejectRequest(fd({ id: "req", comment: "取消" })))).toContain("打刻修正の承認待ち"); expect(await redirected(() => cancelRequest(fd({ id: "req" })))).toContain("打刻修正の承認待ち");
  });
  it("close/reopen preserves correction history and actual timestamps", async () => {
    const c = await createCorrection(db, "member", "req", input()); await decideCorrection(db, "admin", c.id, true); expect(await redirected(() => closeMonth(fd({ ym: "2026-10" })))).toContain("msg="); expect(await db.query.monthlyCloses.findMany()).toHaveLength(1);
    expect(await redirected(() => reopenMonth(fd({ ym: "2026-10" })))).toContain("msg="); expect((await history())[0].status).toBe("APPROVED"); expect((await actual())?.endedAt).toEqual(at("20:00"));
  });
  it("three simultaneous month closes complete under pool max3", async () => {
    const out = await Promise.all(["2026-07", "2026-08", "2026-09"].map(ym => redirected(() => closeMonth(fd({ ym }))))); expect(out.every(x => x.includes("msg="))).toBe(true);
  }, 10000);
  it("month-close race cannot leave pending correction in a closed month", async () => {
    await Promise.allSettled([createCorrection(db, "member", "req", input()), closeMonth(fd({ ym: "2026-10" }))]); const closed = await db.query.monthlyCloses.findFirst({ where: eq(t.monthlyCloses.yearMonth, "2026-10") });
    const pending = (await history()).filter(c => c.status === "PENDING"); expect(closed ? pending.length === 0 : pending.length === 1).toBe(true);
  });
  it("requests open-start cancellation without mutating actual record", async () => {
    const r = await addRecord({ startedAt: at("15:37") }); const c = await createStartCancellation(db, "member", "req", { reason: "開始ボタンの押し間違い" });
    expect(c).toMatchObject({ kind: "VOID_START", status: "PENDING", proposedStartedAt: null, proposedEndedAt: null, proposedBreakMinutes: null, originalStartedAt: at("15:37"), originalEndedAt: null });
    expect(await actual()).toEqual(r); expect(await db.query.changeLogs.findMany()).toHaveLength(1);
  });
  it("approves cancellation as a retained voided row, never deletes original start", async () => {
    const r = await addRecord({ startedAt: at("15:37") }); const reqBefore = await db.query.overtimeRequests.findFirst({ where: eq(t.overtimeRequests.id, "req") });
    const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await decideCorrection(db, "admin", c.id, true);
    const stored = await actual(); expect(stored).toMatchObject({ id: r.id, startedAt: at("15:37"), endedAt: null }); expect(stored?.voidedAt).toBeInstanceOf(Date); expect(activeTimeRecord(stored)).toBeNull();
    expect(await db.query.overtimeRequests.findFirst({ where: eq(t.overtimeRequests.id, "req") })).toEqual(reqBefore);
    expect((await history())[0]).toMatchObject({ status: "APPROVED", kind: "VOID_START", originalStartedAt: at("15:37"), reviewerId: "admin" });
    const logs = await db.query.changeLogs.findMany({ where: eq(t.changeLogs.targetTable, "time_records") }); expect(logs).toHaveLength(1); expect(logs[0].before).toMatchObject({ startedAt: at("15:37").toISOString(), voidedAt: null }); expect(logs[0].after).toMatchObject({ startedAt: at("15:37").toISOString(), correctionId: c.id });
  });
  it("rejects canceling a missing start", async () => { await expect(createStartCancellation(db, "member", "req", { reason: "誤操作" })).rejects.toThrow("終了前"); });
  it("rejects canceling an already finished or zero-duration record", async () => { await addRecord({ startedAt: at("19:08"), endedAt: at("19:08") }); await expect(createStartCancellation(db, "member", "req", { reason: "誤操作" })).rejects.toThrow("終了前"); });
  it("requires nonblank cancellation reason up to500 characters", async () => {
    await addRecord(); for (const reason of ["", " ", "a".repeat(501), null]) await expect(createStartCancellation(db, "member", "req", { reason })).rejects.toThrow(); expect(await history()).toHaveLength(0);
  });
  it("enforces cancellation owner and active employee", async () => {
    await addRecord(); await expect(createStartCancellation(db, "other", "req", { reason: "誤操作" })).rejects.toThrow("見つかりません"); await db.update(t.employees).set({ isActive: false }).where(eq(t.employees.id, "member")); await expect(createStartCancellation(db, "member", "req", { reason: "誤操作" })).rejects.toThrow("権限");
  });
  it("rejects cancellation of canceled underlying overtime", async () => { await addRecord(); await db.update(t.overtimeRequests).set({ status: "CANCELED" }).where(eq(t.overtimeRequests.id, "req")); await expect(createStartCancellation(db, "member", "req", { reason: "誤操作" })).rejects.toThrow("取り消せません"); });
  it("blocks cancellation when a legacy request is unresolved", async () => { await addRecord({ correctionRequest: "旧依頼" }); await expect(createStartCancellation(db, "member", "req", { reason: "誤操作" })).rejects.toThrow("以前の修正"); });
  it("serializes simultaneous cancellation and timestamp correction", async () => {
    await addRecord(); const results = await Promise.allSettled([createStartCancellation(db, "member", "req", { reason: "誤操作" }), createCorrection(db, "member", "req", input())]); expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(await history()).toHaveLength(1);
  });
  it("withdrawn cancellation leaves the start unchanged", async () => {
    const r = await addRecord(); const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await withdrawCorrection(db, "member", c.id); expect(await actual()).toEqual(r); expect((await history())[0].status).toBe("CANCELED");
  });
  it("rejected cancellation leaves the start unchanged and preserves rejection reason", async () => {
    const r = await addRecord(); const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await decideCorrection(db, "admin", c.id, false, "実際の勤務を確認してください"); expect(await actual()).toEqual(r); expect((await history())[0]).toMatchObject({ status: "REJECTED", rejectComment: "実際の勤務を確認してください" });
  });
  it("requires admin to approve cancellation", async () => { await addRecord(); const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await expect(decideCorrection(db, "member", c.id, true)).rejects.toThrow("権限"); expect((await actual())?.voidedAt).toBeNull(); });
  it("rejects cancellation approval if source start or end changed", async () => {
    await addRecord(); const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await db.update(t.timeRecords).set({ endedAt: at("20:00") }).where(eq(t.timeRecords.requestId, "req")); await expect(decideCorrection(db, "admin", c.id, true)).rejects.toThrow("申請後"); expect((await actual())?.voidedAt).toBeNull();
  });
  it("blocks cancellation submit/decision/withdrawal after month closure", async () => {
    await addRecord(); const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await db.insert(t.monthlyCloses).values({ yearMonth: "2026-10", closedById: "admin" });
    await expect(createStartCancellation(db, "member", "req", { reason: "誤操作" })).rejects.toThrow("確定済み"); await expect(decideCorrection(db, "admin", c.id, true)).rejects.toThrow("確定済み"); await expect(withdrawCorrection(db, "member", c.id)).rejects.toThrow("確定済み");
  });
  it("ordinary start and end cannot bypass pending cancellation", async () => {
    const d = todayYmd(); await db.update(t.overtimeRequests).set({ workDate: d, plannedStart: at("17:00", d), plannedEnd: at("19:00", d) }).where(eq(t.overtimeRequests.id, "req")); await addRecord({ startedAt: at("15:37", d) }); await createStartCancellation(db, "member", "req", { reason: "誤操作" });
    expect(await redirected(() => startStamp(fd({ id: "req" })))).toContain("err="); expect(await redirected(() => endStamp(fd({ id: "req" })))).toContain("承認待ち");
  });
  it("allows normal server-time restart of same row and normal end after cancellation", async () => {
    const d = todayYmd(); await db.update(t.overtimeRequests).set({ workDate: d, plannedStart: at("17:00", d), plannedEnd: at("19:00", d) }).where(eq(t.overtimeRequests.id, "req")); const r = await addRecord({ startedAt: at("15:37", d) });
    const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await decideCorrection(db, "admin", c.id, true); const oldHistory = (await history())[0];
    const before = Date.now(); const response = await redirected(() => startStamp(fd({ id: "req" }))); const after = Date.now(); expect(response).not.toContain("err="); const restarted = await actual(); expect(restarted).toMatchObject({ id: r.id, voidedAt: null, endedAt: null, corrected: false }); expect(restarted!.startedAt.getTime()).toBeGreaterThanOrEqual(before); expect(restarted!.startedAt.getTime()).toBeLessThanOrEqual(after);
    expect(await redirected(() => endStamp(fd({ id: "req", breakMinutes: "0" })))).toContain("msg="); expect((await actual())?.endedAt).toBeInstanceOf(Date); expect((await history())[0]).toEqual(oldHistory);
    const snapshot = await actual(); await expect(decideCorrection(db, "admin", c.id, true)).rejects.toThrow("処理済み"); expect(await actual()).toEqual(snapshot);
  });
  it("a voided start cannot be ended or manually corrected before restarting", async () => {
    const r = await addRecord(); const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await decideCorrection(db, "admin", c.id, true);
    expect(await redirected(() => endStamp(fd({ id: "req" })))).toContain("開始の打刻がありません"); expect(await redirected(() => correctRecord(fd({ recordId: r.id, start: "18:00", end: "20:00", reason: "手修正" })))).toContain("打刻が見つかりません"); await expect(createStartCancellation(db, "member", "req", { reason: "誤操作" })).rejects.toThrow("終了前");
  });
  it("after cancellation a complete missing-punch correction reuses row and preserves cancel history", async () => {
    const r = await addRecord(); const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await decideCorrection(db, "admin", c.id, true); const oldHistory = (await history())[0];
    const corrected = await createCorrection(db, "member", "req", input()); expect(corrected.originalRecordId).toBeNull(); await decideCorrection(db, "admin", corrected.id, true); expect(await actual()).toMatchObject({ id: r.id, voidedAt: null, startedAt: at("18:00"), endedAt: at("20:00") }); expect((await history()).find(x => x.id === c.id)).toEqual(oldHistory);
  });
  it("voided record does not block another known overlapping correction", async () => {
    await addOther(at("19:00"), null); const c = await createStartCancellation(db, "member", "other-req", { reason: "誤操作" }); await decideCorrection(db, "admin", c.id, true); expect((await createCorrection(db, "member", "req", input())).status).toBe("PENDING");
  });
  it("voided record is excluded from monthly unfinished checks and actual totals", async () => {
    await addRecord(); const c = await createStartCancellation(db, "member", "req", { reason: "誤操作" }); await decideCorrection(db, "admin", c.id, true); const result = await computeEmployeeMonth({ id: "member", name: "検証", email: "member@example.com" }, "2026-10"); expect(result.totals.statutoryMinutes).toBe(0); expect(await redirected(() => closeMonth(fd({ ym: "2026-10" })))).toContain("msg="); expect((await history())[0].status).toBe("APPROVED");
  });
  it("database enforces cancellation proposal has no invented timestamps", async () => {
    const r = await addRecord(); await expect(db.insert(t.timeCorrectionRequests).values({ kind: "VOID_START", requestId: "req", employeeId: "member", originalRecordId: r.id, proposedStartedAt: at("18:00"), proposedEndedAt: at("20:00"), reason: "不正な形" })).rejects.toThrow(); expect(await history()).toHaveLength(0);
  });

});
