import { z } from "zod";
import type { TimeCorrectionRequest, TimeRecord } from "@/db/schema";
import { jstDateTime } from "./time";
import { activeTimeRecord } from "./time-record";
export class CorrectionError extends Error {}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
const date = z.string().refine(validDate, "正しい日付を入力してください。");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "正しい時刻を入力してください。");
const reasonSchema = z.string().trim().min(1, "理由を入力してください。").max(500, "理由は500文字以内にしてください。");
export function validateCancellationReason(input: unknown) {
  const parsed = z.object({ reason: reasonSchema }).safeParse(input);
  if (!parsed.success) throw new CorrectionError(parsed.error.issues[0].message);
  return parsed.data.reason;
}
const inputSchema = z.object({
  startDate: date, start: time, endDate: date, end: time,
  breakMinutes: z.preprocess(value => typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN, z.number().int().min(0).max(600)),
  reason: z.string().trim().min(1, "修正の理由を入力してください。").max(500, "理由は500文字以内にしてください。"),
});
export function validateCorrection(input: unknown, workDate: string, now = new Date()) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new CorrectionError(parsed.error.issues[0].message);
  const { startDate, start, endDate, end, breakMinutes, reason } = parsed.data;
  if (startDate !== workDate) throw new CorrectionError("開始日は残業申請の対象日と同じ日にしてください。");
  const startedAt = jstDateTime(startDate, start);
  const endedAt = jstDateTime(endDate, end);
  if (endedAt <= startedAt) throw new CorrectionError("終了日時は開始日時より後にしてください。日をまたぐ場合は終了日を翌日にしてください。");
  if (endedAt.getTime() - startedAt.getTime() > 16 * 3600_000) throw new CorrectionError("1回の打刻は16時間以内にしてください。");
  if (endedAt > now) throw new CorrectionError("まだ到来していない日時は申請できません。残業が終了してから申請してください。");
  if (breakMinutes * 60000 >= endedAt.getTime() - startedAt.getTime()) throw new CorrectionError("休憩時間は開始から終了までの時間より短くしてください。");
  return { startedAt, endedAt, breakMinutes, reason };
}
type Snapshot = Pick<TimeCorrectionRequest, "originalRecordId" | "originalStartedAt" | "originalEndedAt" | "originalBreakMinutes" | "originalUpdatedAt">;
export function recordSnapshot(value: TimeRecord | null | undefined): Snapshot {
  const record = activeTimeRecord(value);
  return {
    originalRecordId: record?.id ?? null, originalStartedAt: record?.startedAt ?? null,
    originalEndedAt: record?.endedAt ?? null, originalBreakMinutes: record?.breakMinutes ?? null,
    originalUpdatedAt: record?.updatedAt ?? null,
  };
}
export function snapshotMatches(correction: Snapshot, current: TimeRecord | null | undefined) {
  const original = recordSnapshot(current);
  return (Object.keys(original) as (keyof Snapshot)[]).every(key => {
    const a = correction[key], b = original[key];
    return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  });
}
