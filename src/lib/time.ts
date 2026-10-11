// JST（UTC+9、サマータイムなし）の日付・時刻ヘルパー。
// サーバーのタイムゾーン設定に依存しないよう、固定オフセットで計算する。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** JSTの壁時計の値を getUTC* で読めるようにずらした Date */
function shift(d: Date): Date {
  return new Date(d.getTime() + JST_OFFSET_MS);
}

/** 日時 → JSTの日付 "YYYY-MM-DD" */
export function ymdOf(d: Date): string {
  return shift(d).toISOString().slice(0, 10);
}

/** @db.Date で保存された日付（UTC 0時）→ "YYYY-MM-DD" */
export function ymdOfDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → @db.Date 用の Date（UTC 0時） */
export function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function todayYmd(now: Date = new Date()): string {
  return ymdOf(now);
}

/** JSTの日付と "HH:MM" → 日時 */
export function jstDateTime(ymd: string, hm: string): Date {
  return new Date(`${ymd}T${hm}:00+09:00`);
}

/** 日時 → JSTの "HH:MM" */
export function hmOf(d: Date): string {
  return shift(d).toISOString().slice(11, 16);
}

/** JSTの時（0〜23） */
export function jstHour(d: Date): number {
  return shift(d).getUTCHours();
}

/** 曜日（0=日曜） */
export function weekdayOf(ymd: string): number {
  return dateOnly(ymd).getUTCDay();
}

/** 分 → "H:MM" */
export function fmtMinutes(min: number): string {
  const sign = min < 0 ? "-" : "";
  const m = Math.abs(Math.round(min));
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** "2026-10-09" → "10/9（金）" */
export function fmtDateShort(ymd: string): string {
  const [, mo, da] = ymd.split("-").map(Number);
  return `${mo}/${da}（${WEEKDAYS_JA[weekdayOf(ymd)]}）`;
}

/** "2026-10-09" → "2026年10月9日（金）" */
export function fmtDateLong(ymd: string): string {
  const [y, mo, da] = ymd.split("-").map(Number);
  return `${y}年${mo}月${da}日（${WEEKDAYS_JA[weekdayOf(ymd)]}）`;
}

export function ymOf(ymd: string): string {
  return ymd.slice(0, 7);
}

export function currentYm(now: Date = new Date()): string {
  return ymOf(todayYmd(now));
}

export function isValidYm(ym: string | undefined | null): ym is string {
  return !!ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

export function shiftYm(ym: string, months: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

export function fmtYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}

/** 月の初日・末日（"YYYY-MM-DD"） */
export function monthBounds(ym: string): { first: string; last: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first: `${ym}-01`, last };
}

export function addDays(ymd: string, days: number): string {
  const d = dateOnly(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 支払日：対象月の翌月25日。土日・休日なら前営業日。
 * @param holidays 休日の "YYYY-MM-DD" 集合
 */
export function paydayOf(ym: string, holidays: Set<string> = new Set()): string {
  let d = `${shiftYm(ym, 1)}-25`;
  for (;;) {
    const wd = weekdayOf(d);
    if (wd !== 0 && wd !== 6 && !holidays.has(d)) return d;
    d = addDays(d, -1);
  }
}

export function fmtYen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}
