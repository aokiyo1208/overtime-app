import { describe, expect, it } from "vitest";
import type { TimeRecord } from "../db/schema";
import { CorrectionError, recordSnapshot, snapshotMatches, validateCorrection } from "./correction-validation";
import { jstDateTime } from "./time";
const date = "2026-10-31";
const now = jstDateTime("2026-11-02", "12:00");
const base = { startDate: date, start: "18:00", endDate: date, end: "20:00", breakMinutes: "0", reason: "打刻を忘れたため" };
const validate = (overrides: Record<string, unknown> = {}, workDate = date, clock = now) => validateCorrection({ ...base, ...overrides }, workDate, clock);
function record(overrides: Partial<TimeRecord> = {}): TimeRecord {
  return { id: "record-1", requestId: "request-1", employeeId: "member-1", startedAt: jstDateTime(date, "18:00"), endedAt: jstDateTime(date, "20:00"), breakMinutes: 15, voidedAt: null, excessStatus: "NONE", correctionRequest: null, corrected: false, createdAt: new Date("2026-10-31T11:00:00.123Z"), updatedAt: new Date("2026-10-31T11:00:00.123Z"), ...overrides };
}
describe("打刻修正の入力検証", () => {
  it("JSTの日時と整数分を返し、理由の前後空白を除く", () => {
    expect(validate({ breakMinutes: "17", reason: "  打刻忘れ\n " })).toEqual({ startedAt: new Date("2026-10-31T09:00:00Z"), endedAt: new Date("2026-10-31T11:00:00Z"), breakMinutes: 17, reason: "打刻忘れ" });
  });
  it.each(["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "2026-1-01", "not-a-date", "", "2026-10-31T00:00:00Z"])("存在しない・非正規の日付 %s を拒否する", invalidDate => {
    expect(() => validate({ startDate: invalidDate }, invalidDate)).toThrow(CorrectionError);
    expect(() => validate({ endDate: invalidDate })).toThrow(CorrectionError);
  });
  it("うるう年の2月29日は認める", () => {
    expect(validateCorrection({ ...base, startDate: "2024-02-29", endDate: "2024-02-29" }, "2024-02-29", now).startedAt).toEqual(jstDateTime("2024-02-29", "18:00"));
  });
  it.each(["24:00", "23:60", "-1:00", "9:00", "18:00:01", "", "aa:bb"])("不正な時刻 %s を拒否する", time => {
    expect(() => validate({ start: time })).toThrow(CorrectionError);
    expect(() => validate({ end: time })).toThrow(CorrectionError);
  });
  it("開始日を対象日から移動させない", () => {
    expect(() => validate({ startDate: "2026-10-30", endDate: "2026-10-30" })).toThrow("開始日は残業申請");
  });
  it("同時刻・終了が開始より前を拒否し、自動的に翌日と解釈しない", () => {
    expect(() => validate({ end: "18:00" })).toThrow("終了日時");
    expect(() => validate({ start: "23:00", end: "01:00" })).toThrow("終了日時");
    expect(() => validate({ endDate: "2026-10-30" })).toThrow("終了日時");
  });
  it("翌日・翌月にまたがる明示的な日時を認める", () => {
    const result = validate({ start: "23:00", endDate: "2026-11-01", end: "01:00" });
    expect(result.startedAt).toEqual(new Date("2026-10-31T14:00:00Z"));
    expect(result.endedAt).toEqual(new Date("2026-10-31T16:00:00Z"));
  });
  it("年をまたぐ区間を認める", () => {
    const result = validateCorrection({ ...base, startDate: "2025-12-31", start: "23:00", endDate: "2026-01-01", end: "01:00" }, "2025-12-31", now);
    expect(result.endedAt.getTime() - result.startedAt.getTime()).toBe(120 * 60_000);
  });
  it("16時間ちょうどは認め、16時間1分は拒否する", () => {
    expect(validate({ start: "16:00", endDate: "2026-11-01", end: "08:00" }).endedAt).toEqual(jstDateTime("2026-11-01", "08:00"));
    expect(() => validate({ start: "16:00", endDate: "2026-11-01", end: "08:01" })).toThrow("16時間以内");
  });
  it("現在時刻ちょうどの終了は認め、1ms未来の終了は拒否する", () => {
    const end = jstDateTime(date, "20:00");
    expect(validate({}, date, end).endedAt).toEqual(end);
    expect(() => validate({}, date, new Date(end.getTime() - 1))).toThrow("まだ到来していない");
  });
  it.each([0, "0", 1, "1", "119"])("整数分の休憩 %s を認める（5分刻みに限定しない）", breakMinutes => {
    expect(validate({ breakMinutes }).breakMinutes).toBe(Number(breakMinutes));
  });
  it.each([-1, "-1", "1.5", "abc", Number.NaN, Number.POSITIVE_INFINITY, "601"])("不正な休憩 %s を拒否する", breakMinutes => {
    expect(() => validate({ breakMinutes })).toThrow(CorrectionError);
  });
  it.each(["", "   ", null, false, true, [], undefined].map(value => [value]))("未入力・数値でない休憩 %j をゼロに読み替えない", breakMinutes => {
    expect(() => validate({ breakMinutes })).toThrow(CorrectionError);
  });
  it("600分の休憩を許可するが、打刻区間以上の休憩は拒否する", () => {
    expect(validate({ start: "04:00", end: "20:00", breakMinutes: "600" }).breakMinutes).toBe(600);
    expect(() => validate({ breakMinutes: "120" })).toThrow("休憩時間");
    expect(() => validate({ breakMinutes: "121" })).toThrow("休憩時間");
    expect(validate({ end: "18:01", breakMinutes: "0" }).breakMinutes).toBe(0);
    expect(() => validate({ end: "18:01", breakMinutes: "1" })).toThrow("休憩時間");
  });
  it("理由は前後空白を除いて1〜500文字必要", () => {
    expect(() => validate({ reason: " \n\t " })).toThrow(CorrectionError);
    expect(validate({ reason: "あ".repeat(500) }).reason).toHaveLength(500);
    expect(() => validate({ reason: "あ".repeat(501) })).toThrow(CorrectionError);
  });
});
describe("修正元の打刻スナップショット", () => {
  it("打刻なしはすべてnullで保存し、存在しない打刻と一致する", () => {
    const empty = { originalRecordId: null, originalStartedAt: null, originalEndedAt: null, originalBreakMinutes: null, originalUpdatedAt: null };
    expect(recordSnapshot(null)).toEqual(empty);
    expect(recordSnapshot(undefined)).toEqual(empty);
    expect(snapshotMatches(empty, null)).toBe(true);
    expect(snapshotMatches(empty, undefined)).toBe(true);
    expect(snapshotMatches(empty, record())).toBe(false);
  });
  it("オブジェクト同一性ではなく日時の値で比較する", () => { expect(snapshotMatches(recordSnapshot(record()), record())).toBe(true); });
  it.each<Partial<TimeRecord>>([{ id: "recreated-record" }, { startedAt: jstDateTime(date, "18:01") }, { endedAt: jstDateTime(date, "20:01") }, { endedAt: null }, { breakMinutes: 16 }, { updatedAt: new Date("2026-10-31T11:00:00.124Z") }])("修正元が変わった場合は一致しない: %j", overrides => { expect(snapshotMatches(recordSnapshot(record()), record(overrides))).toBe(false); });
  it("打刻の削除、未終了から終了への変更を検出する", () => {
    expect(snapshotMatches(recordSnapshot(record()), null)).toBe(false);
    expect(snapshotMatches(recordSnapshot(record({ endedAt: null })), record())).toBe(false);
  });
  it("PostgreSQLのマイクロ秒をDateに読み込んだ比較で誤って変更扱いしない", () => {
    const current = record({ updatedAt: new Date("2026-10-31T11:00:00.123456Z") });
    const persisted = { ...recordSnapshot(current), originalUpdatedAt: new Date("2026-10-31T11:00:00.123Z") };
    expect(snapshotMatches(persisted, current)).toBe(true);
  });
  it("Date比較の精度はミリ秒単位であることを明示する", () => {
    const original = record({ updatedAt: new Date("2026-10-31T11:00:00.123456Z") });
    const current = record({ updatedAt: new Date("2026-10-31T11:00:00.123999Z") });
    expect(snapshotMatches(recordSnapshot(original), current)).toBe(true);
  });
});
