// 残業申請システム データモデル（仕様書 5章）
// 日時はUTC（timestamptz）で保存し、画面ではJSTで表示する。
// 日付（対象日など）は "YYYY-MM-DD" の文字列で扱う。時間は分、金額は円の整数。

import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const day = (name: string) => date(name, { mode: "string" });

export const roleEnum = pgEnum("role", ["MEMBER", "ADMIN"]);
export const payTypeEnum = pgEnum("pay_type", ["MONTHLY", "HOURLY"]);
export const requestStatusEnum = pgEnum("request_status", ["PENDING", "APPROVED", "REJECTED", "CANCELED"]);
export const excessStatusEnum = pgEnum("excess_status", ["NONE", "PENDING", "APPROVED", "REJECTED"]);

export const employees = pgTable("employees", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("MEMBER"),
  department: text("department"),
  joinedOn: day("joined_on"),
  leftOn: day("left_on"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** 給与マスタ。改定は行を追加し、対象月の末日時点で有効な行を使う。 */
export const salaries = pgTable(
  "salaries",
  {
    id: id(),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    payType: payTypeEnum("pay_type").notNull(),
    /** 月給制：基本給（円） */
    basePay: integer("base_pay").notNull().default(0),
    /** 月給制：時間単価に算入する手当の合計（円） */
    includedAllowances: integer("included_allowances").notNull().default(0),
    /** 時給制：時給（円） */
    hourlyWage: integer("hourly_wage"),
    effectiveFrom: day("effective_from").notNull(),
    note: text("note"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("salaries_emp_from").on(t.employeeId, t.effectiveFrom)],
);

export const overtimeRequests = pgTable(
  "overtime_requests",
  {
    id: id(),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    /** 対象日（JST）。月・休日の判定はこの日付で行う */
    workDate: day("work_date").notNull(),
    plannedStart: ts("planned_start").notNull(),
    plannedEnd: ts("planned_end").notNull(),
    task: text("task").notNull(),
    reason: text("reason").notNull(),
    isAfterTheFact: boolean("is_after_the_fact").notNull().default(false),
    status: requestStatusEnum("status").notNull().default("PENDING"),
    approverId: text("approver_id").references(() => employees.id),
    decidedAt: ts("decided_at"),
    rejectComment: text("reject_comment"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("requests_emp_date").on(t.employeeId, t.workDate), index("requests_status").on(t.status)],
);

export const timeRecords = pgTable("time_records", {
  id: id(),
  requestId: text("request_id").notNull().unique().references(() => overtimeRequests.id),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  startedAt: ts("started_at").notNull(),
  endedAt: ts("ended_at"),
  breakMinutes: integer("break_minutes").notNull().default(0),
  /** 承認された予定時間を超えた分の扱い */
  excessStatus: excessStatusEnum("excess_status").notNull().default("NONE"),
  /** 社員からの打刻修正依頼（管理者が対応したら空にする） */
  correctionRequest: text("correction_request"),
  corrected: boolean("corrected").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});

/** 打刻・申請・給与マスタの変更履歴（監査用） */
export const changeLogs = pgTable(
  "change_logs",
  {
    id: id(),
    targetTable: text("target_table").notNull(),
    targetId: text("target_id").notNull(),
    changedById: text("changed_by_id").notNull(),
    changedAt: ts("changed_at").notNull().defaultNow(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
  },
  (t) => [index("change_logs_target").on(t.targetTable, t.targetId)],
);

/** 月次確定。行がある月は申請・打刻・承認がロックされる */
export const monthlyCloses = pgTable("monthly_closes", {
  yearMonth: text("year_month").primaryKey(), // "2026-09"
  closedById: text("closed_by_id").notNull(),
  closedAt: ts("closed_at").notNull().defaultNow(),
});

/** 確定時のスナップショット。後で給与マスタを変えても確定済みの金額は変わらない */
export const monthlySummaries = pgTable(
  "monthly_summaries",
  {
    id: id(),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    yearMonth: text("year_month").notNull(),
    innerMinutes: integer("inner_minutes").notNull(),
    statutoryMinutes: integer("statutory_minutes").notNull(),
    over60Minutes: integer("over60_minutes").notNull(),
    nightMinutes: integer("night_minutes").notNull(),
    holidayMinutes: integer("holiday_minutes").notNull(),
    hourlyRate: doublePrecision("hourly_rate"),
    amount: integer("amount"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("summaries_emp_month").on(t.employeeId, t.yearMonth)],
);

/** システム設定（1行のみ、id = 1） */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  /** 1日の所定労働時間（分） */
  dailyMinutes: integer("daily_minutes").notNull().default(480),
  /** 年間所定休日数 */
  annualHolidays: integer("annual_holidays").notNull().default(120),
  /** 法定休日の曜日（0=日曜 … 6=土曜） */
  legalHolidayWeekday: integer("legal_holiday_weekday").notNull().default(0),
  /** 所定休日の曜日（カンマ区切り。"6" = 土曜） */
  companyHolidayWeekdays: text("company_holiday_weekdays").notNull().default("6"),
  /** 法定内残業に割増（1.25）を付けるか */
  premiumForInner: boolean("premium_for_inner").notNull().default(false),
  /** 36協定 月の上限（分） */
  limitMonthMinutes: integer("limit_month_minutes").notNull().default(2700),
  /** 36協定 年の上限（分） */
  limitYearMinutes: integer("limit_year_minutes").notNull().default(21600),
  /** 36協定の起算月（1〜12） */
  agreementStartMonth: integer("agreement_start_month").notNull().default(4),
  /** 上限に対する注意表示の割合（%） */
  warnPercent: integer("warn_percent").notNull().default(80),
});

/** 祝日・会社休日 */
export const holidays = pgTable("holidays", {
  date: day("date").primaryKey(),
  name: text("name").notNull(),
  /** true = 法定休日、false = 所定休日 */
  isLegal: boolean("is_legal").notNull().default(false),
});

export const employeesRelations = relations(employees, ({ many }) => ({
  salaries: many(salaries),
  requests: many(overtimeRequests, { relationName: "requester" }),
}));
export const salariesRelations = relations(salaries, ({ one }) => ({
  employee: one(employees, { fields: [salaries.employeeId], references: [employees.id] }),
}));
export const overtimeRequestsRelations = relations(overtimeRequests, ({ one }) => ({
  employee: one(employees, { fields: [overtimeRequests.employeeId], references: [employees.id], relationName: "requester" }),
  timeRecord: one(timeRecords, { fields: [overtimeRequests.id], references: [timeRecords.requestId] }),
}));
export const timeRecordsRelations = relations(timeRecords, ({ one }) => ({
  request: one(overtimeRequests, { fields: [timeRecords.requestId], references: [overtimeRequests.id] }),
  employee: one(employees, { fields: [timeRecords.employeeId], references: [employees.id] }),
}));
export const monthlySummariesRelations = relations(monthlySummaries, ({ one }) => ({
  employee: one(employees, { fields: [monthlySummaries.employeeId], references: [employees.id] }),
}));

export type Employee = typeof employees.$inferSelect;
export type Salary = typeof salaries.$inferSelect;
export type OvertimeRequest = typeof overtimeRequests.$inferSelect;
export type TimeRecord = typeof timeRecords.$inferSelect;
export type Setting = typeof settings.$inferSelect;
