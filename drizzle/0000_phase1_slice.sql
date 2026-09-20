CREATE TABLE `audit_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`summary` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_entries` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pot_id` integer NOT NULL,
	`amount_pence` integer NOT NULL,
	`effective_at` integer NOT NULL,
	`note` text,
	`entered_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `checkpoints_pot_effective_idx` ON `checkpoints` (`pot_id`,`effective_at`);--> statement-breakpoint
CREATE TABLE `pots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`overdraft_limit_pence` integer,
	`warning_threshold_pence` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
