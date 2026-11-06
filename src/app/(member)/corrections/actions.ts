"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/session";
import { createCorrection, createStartCancellation, decideCorrection, withdrawCorrection } from "@/lib/corrections";
import { CorrectionError } from "@/lib/correction-validation";
function back(path: string, kind: "msg" | "err", message: string): never { redirect(`${path}?${kind}=${encodeURIComponent(message)}`); }
function message(error: unknown) {
  if (error instanceof CorrectionError) return error.message;
  console.error("[correction] operation failed");
  return "処理できませんでした。画面を再読み込みして状況を確認してください。";
}
const pathFor = (id: string) => `/corrections/${encodeURIComponent(id)}`;
export async function submitCorrection(fd: FormData) {
  const me = await requireUser();
  const id = String(fd.get("requestId") ?? "");
  let error: string | undefined;
  try { await createCorrection(db, me.id, id, Object.fromEntries(fd)); } catch (e) { error = message(e); }
  revalidatePath("/", "layout");
  back(pathFor(id), error ? "err" : "msg", error ?? "打刻修正を申請しました。承認されるまで打刻は変更されません。");
}
export async function submitStartCancellation(fd: FormData) {
  const me = await requireUser();
  const id = String(fd.get("requestId") ?? "");
  let error: string | undefined;
  try { await createStartCancellation(db, me.id, id, { reason: fd.get("reason") }); } catch (e) { error = message(e); }
  revalidatePath("/", "layout");
  back(pathFor(id), error ? "err" : "msg", error ?? "開始打刻の取消を申請しました。管理者の承認後に未打刻へ戻ります。");
}
export async function cancelCorrection(fd: FormData) {
  const me = await requireUser();
  let requestId: string | undefined, error: string | undefined;
  try { ({ requestId } = await withdrawCorrection(db, me.id, String(fd.get("correctionId") ?? ""))); } catch (e) { error = message(e); }
  revalidatePath("/", "layout");
  back(requestId ? pathFor(requestId) : "/history", error ? "err" : "msg", error ?? "修正申請を取り消しました。打刻は変更されていません。");
}
async function decide(fd: FormData, approve: boolean) {
  const admin = await requireAdmin();
  let error: string | undefined, isStartCancellation = false;
  try { const result = await decideCorrection(db, admin.id, String(fd.get("correctionId") ?? ""), approve, String(fd.get("comment") ?? "")); isStartCancellation = result.kind === "VOID_START"; } catch (e) { error = message(e); }
  revalidatePath("/", "layout");
  back("/admin/approvals", error ? "err" : "msg", error ?? (approve ? (isStartCancellation ? "開始打刻の取消を承認し、未打刻に戻しました。残業申請の承認状態は変わりません。" : "打刻修正を承認して反映しました。残業申請・予定超過の承認は別に確認してください。") : "打刻変更の申請を却下しました。理由を本人の履歴に記録しました。"));
}
export async function approveCorrection(fd: FormData) { await decide(fd, true); }
export async function rejectCorrection(fd: FormData) { await decide(fd, false); }
