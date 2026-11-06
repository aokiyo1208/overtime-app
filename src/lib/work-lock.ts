import { eq, sql } from "drizzle-orm";
import { monthlyCloses, overtimeRequests } from "@/db/schema";
import type { Tx } from "./db";
import { ymOf } from "./time";
/** Serialize payroll-affecting writes and month close/reopen for the same month. */
export async function lockMonth(tx: Tx, ym: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'overtime-month:' + ym}))`);
}
export async function lockEmployee(tx: Tx, employeeId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'overtime-employee:' + employeeId}))`);
}
export async function lockedRequest(tx: Tx, id: string) {
  const found = await tx.query.overtimeRequests.findFirst({ where: eq(overtimeRequests.id, id) });
  if (!found) return null;
  await lockMonth(tx, ymOf(found.workDate));
  await lockEmployee(tx, found.employeeId);
  const [request] = await tx.select().from(overtimeRequests).where(eq(overtimeRequests.id, id)).for("update");
  return request ?? null;
}
export async function monthClosed(tx: Tx, workDate: string) {
  return !!await tx.query.monthlyCloses.findFirst({ where: eq(monthlyCloses.yearMonth, ymOf(workDate)) });
}
