CREATE TYPE "public"."excess_status" AS ENUM('NONE', 'PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."pay_type" AS ENUM('MONTHLY', 'HOURLY');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('MEMBER', 'ADMIN');--> statement-breakpoint
CREATE TABLE "change_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"target_table" text NOT NULL,
	"target_id" text NOT NULL,
	"changed_by_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "role" DEFAULT 'MEMBER' NOT NULL,
	"department" text,
	"joined_on" date,
	"left_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_legal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_closes" (
	"year_month" text PRIMARY KEY NOT NULL,
	"closed_by_id" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"year_month" text NOT NULL,
	"inner_minutes" integer NOT NULL,
	"statutory_minutes" integer NOT NULL,
	"over60_minutes" integer NOT NULL,
	"night_minutes" integer NOT NULL,
	"holiday_minutes" integer NOT NULL,
	"hourly_rate" double precision,
	"amount" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overtime_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"work_date" date NOT NULL,
	"planned_start" timestamp with time zone NOT NULL,
	"planned_end" timestamp with time zone NOT NULL,
	"task" text NOT NULL,
	"reason" text NOT NULL,
	"is_after_the_fact" boolean DEFAULT false NOT NULL,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"approver_id" text,
	"decided_at" timestamp with time zone,
	"reject_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salaries" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"pay_type" "pay_type" NOT NULL,
	"base_pay" integer DEFAULT 0 NOT NULL,
	"included_allowances" integer DEFAULT 0 NOT NULL,
	"hourly_wage" integer,
	"effective_from" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"daily_minutes" integer DEFAULT 480 NOT NULL,
	"annual_holidays" integer DEFAULT 120 NOT NULL,
	"legal_holiday_weekday" integer DEFAULT 0 NOT NULL,
	"company_holiday_weekdays" text DEFAULT '6' NOT NULL,
	"premium_for_inner" boolean DEFAULT false NOT NULL,
	"limit_month_minutes" integer DEFAULT 2700 NOT NULL,
	"limit_year_minutes" integer DEFAULT 21600 NOT NULL,
	"agreement_start_month" integer DEFAULT 4 NOT NULL,
	"warn_percent" integer DEFAULT 80 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_records" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"excess_status" "excess_status" DEFAULT 'NONE' NOT NULL,
	"correction_request" text,
	"corrected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_records_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_approver_id_employees_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_request_id_overtime_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."overtime_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_logs_target" ON "change_logs" USING btree ("target_table","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "summaries_emp_month" ON "monthly_summaries" USING btree ("employee_id","year_month");--> statement-breakpoint
CREATE INDEX "requests_emp_date" ON "overtime_requests" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "requests_status" ON "overtime_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "salaries_emp_from" ON "salaries" USING btree ("employee_id","effective_from");