CREATE TABLE "time_correction_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"original_record_id" text,
	"original_started_at" timestamp with time zone,
	"original_ended_at" timestamp with time zone,
	"original_break_minutes" integer,
	"original_updated_at" timestamp with time zone,
	"proposed_started_at" timestamp with time zone NOT NULL,
	"proposed_ended_at" timestamp with time zone NOT NULL,
	"proposed_break_minutes" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'PENDING' NOT NULL,
	"reviewer_id" text,
	"decided_at" timestamp with time zone,
	"reject_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_correction_requests" ADD CONSTRAINT "time_correction_requests_request_id_overtime_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."overtime_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_correction_requests" ADD CONSTRAINT "time_correction_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_correction_requests" ADD CONSTRAINT "time_correction_requests_original_record_id_time_records_id_fk" FOREIGN KEY ("original_record_id") REFERENCES "public"."time_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_correction_requests" ADD CONSTRAINT "time_correction_requests_reviewer_id_employees_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corrections_emp_created" ON "time_correction_requests" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "corrections_request" ON "time_correction_requests" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "corrections_one_pending" ON "time_correction_requests" USING btree ("request_id") WHERE "time_correction_requests"."status" = 'PENDING';