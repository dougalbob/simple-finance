CREATE TABLE `receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schedule_instance_id` integer,
	`pot_id` integer NOT NULL,
	`amount_pence` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`occurred_date` text NOT NULL,
	`entered_by` text NOT NULL,
	`note` text,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "receipts_amount_positive" CHECK("receipts"."amount_pence" > 0)
);
--> statement-breakpoint
CREATE INDEX `receipts_pot_occurred_idx` ON `receipts` (`pot_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `receipts_occurred_date_idx` ON `receipts` (`occurred_date`);--> statement-breakpoint
CREATE INDEX `receipts_schedule_instance_idx` ON `receipts` (`schedule_instance_id`);--> statement-breakpoint
CREATE TABLE `renewals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`supplier_id` integer,
	`target_kind` text DEFAULT 'household' NOT NULL,
	`target_id` integer,
	`next_renewal_date` text NOT NULL,
	`warn_days_before` integer DEFAULT 21 NOT NULL,
	`repeats_annually` integer DEFAULT true NOT NULL,
	`notes` text,
	`advanced_from` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "renewals_lead_non_negative" CHECK("renewals"."warn_days_before" >= 0)
);
--> statement-breakpoint
CREATE INDEX `renewals_date_idx` ON `renewals` (`next_renewal_date`);--> statement-breakpoint
CREATE TABLE `schedule_instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schedule_id` integer NOT NULL,
	`due_date` text NOT NULL,
	`state` text DEFAULT 'upcoming' NOT NULL,
	`converted_record_kind` text,
	`converted_record_id` integer,
	`converted_at` integer,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedule_instances_state" CHECK((
        ("schedule_instances"."state" = 'upcoming'
          AND "schedule_instances"."converted_record_kind" IS NULL
          AND "schedule_instances"."converted_record_id" IS NULL
          AND "schedule_instances"."converted_at" IS NULL)
        OR
        ("schedule_instances"."state" = 'converted'
          AND "schedule_instances"."converted_record_kind" IS NOT NULL
          AND "schedule_instances"."converted_record_id" IS NOT NULL
          AND "schedule_instances"."converted_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_instances_schedule_date_uidx` ON `schedule_instances` (`schedule_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`frequency` text NOT NULL,
	`due_day_of_month` integer NOT NULL,
	`due_month` integer,
	`amount_pence` integer NOT NULL,
	`pot_id` integer NOT NULL,
	`category_id` integer,
	`target_kind` text DEFAULT 'household' NOT NULL,
	`target_id` integer,
	`contract_ends_on` text,
	`active_from` text NOT NULL,
	`active_until` text,
	`cancelled_at` integer,
	`cancelled_effective_on` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "schedules_due_day_range" CHECK("schedules"."due_day_of_month" BETWEEN 1 AND 31),
	CONSTRAINT "schedules_due_month_rule" CHECK((
        ("schedules"."frequency" = 'monthly' AND "schedules"."due_month" IS NULL)
        OR
        ("schedules"."frequency" = 'annual' AND "schedules"."due_month" BETWEEN 1 AND 12)
      )),
	CONSTRAINT "schedules_amount_positive" CHECK("schedules"."amount_pence" > 0)
);
--> statement-breakpoint
CREATE INDEX `schedules_kind_idx` ON `schedules` (`kind`);--> statement-breakpoint
CREATE INDEX `schedules_pot_idx` ON `schedules` (`pot_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `purchases` ADD `schedule_instance_id` integer;--> statement-breakpoint
CREATE INDEX `purchases_schedule_instance_idx` ON `purchases` (`schedule_instance_id`);