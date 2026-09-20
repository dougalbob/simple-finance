CREATE TABLE `allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`amount_pence` integer NOT NULL,
	`category_id` integer NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` integer,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "allocations_amount_nonzero" CHECK("allocations"."amount_pence" != 0)
);
--> statement-breakpoint
CREATE INDEX `allocations_purchase_idx` ON `allocations` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `allocations_category_idx` ON `allocations` (`category_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`retired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supplier_id` integer,
	`pot_id` integer NOT NULL,
	`total_pence` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`occurred_date` text NOT NULL,
	`paid_by_person_id` integer,
	`entered_by` text NOT NULL,
	`note` text,
	`refund_of_purchase_id` integer,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_of_purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchases_total_nonzero" CHECK("purchases"."total_pence" != 0),
	CONSTRAINT "purchases_refund_sign" CHECK(("purchases"."refund_of_purchase_id" IS NULL AND "purchases"."total_pence" > 0) OR ("purchases"."refund_of_purchase_id" IS NOT NULL AND "purchases"."total_pence" < 0))
);
--> statement-breakpoint
CREATE INDEX `purchases_pot_occurred_idx` ON `purchases` (`pot_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `purchases_supplier_idx` ON `purchases` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `purchases_occurred_date_idx` ON `purchases` (`occurred_date`);--> statement-breakpoint
CREATE INDEX `purchases_refund_of_idx` ON `purchases` (`refund_of_purchase_id`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`contact_phone` text,
	`contact_email` text,
	`website` text,
	`address` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_normalized_uidx` ON `suppliers` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_pot_id` integer NOT NULL,
	`to_pot_id` integer NOT NULL,
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
	FOREIGN KEY (`from_pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_pot_id`) REFERENCES `pots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfers_amount_positive" CHECK("transfers"."amount_pence" > 0),
	CONSTRAINT "transfers_different_pots" CHECK("transfers"."from_pot_id" != "transfers"."to_pot_id")
);
--> statement-breakpoint
CREATE INDEX `transfers_from_occurred_idx` ON `transfers` (`from_pot_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transfers_to_occurred_idx` ON `transfers` (`to_pot_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`owner_person_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Seed the approved two-level category tree (docs/SPEC.md §12). Product
-- default content, not personal data: user-editable from Phase 4, and tests
-- assert this seed matches the spec. People/vehicles/suppliers are household
-- data and are never seeded — the household creates its own.
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	(NULL, 'Housing', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	(NULL, 'Utilities', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	(NULL, 'Groceries', 2, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	(NULL, 'Household Goods', 3, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	(NULL, 'Vehicle Running', 4, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	(NULL, 'Personal', 5, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	(NULL, 'Entertainment & Eating Out', 6, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	(NULL, 'Gifts & Donations', 7, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	(NULL, 'Other', 8, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Housing' AND `parent_id` IS NULL), 'Mortgage/Rent', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Housing' AND `parent_id` IS NULL), 'Council Tax', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Housing' AND `parent_id` IS NULL), 'Buildings & Contents Insurance', 2, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Housing' AND `parent_id` IS NULL), 'DIY & Improvements', 3, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Housing' AND `parent_id` IS NULL), 'Gardening', 4, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Utilities' AND `parent_id` IS NULL), 'Energy', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Utilities' AND `parent_id` IS NULL), 'Water', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Utilities' AND `parent_id` IS NULL), 'Broadband', 2, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Utilities' AND `parent_id` IS NULL), 'Mobile Phones', 3, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Groceries' AND `parent_id` IS NULL), 'Weekly Shop', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Groceries' AND `parent_id` IS NULL), 'Top-up Shops', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Household Goods' AND `parent_id` IS NULL), 'Cleaning & Consumables', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Household Goods' AND `parent_id` IS NULL), 'Homeware & Furnishings', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Household Goods' AND `parent_id` IS NULL), 'Appliances', 2, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Vehicle Running' AND `parent_id` IS NULL), 'Fuel', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Vehicle Running' AND `parent_id` IS NULL), 'Insurance', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Vehicle Running' AND `parent_id` IS NULL), 'Maintenance & Repairs', 2, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Vehicle Running' AND `parent_id` IS NULL), 'Road Tax', 3, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Vehicle Running' AND `parent_id` IS NULL), 'Parking & Tolls', 4, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Personal' AND `parent_id` IS NULL), 'Clothing & Shoes', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Personal' AND `parent_id` IS NULL), 'Health & Toiletries', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Personal' AND `parent_id` IS NULL), 'Hair & Grooming', 2, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Personal' AND `parent_id` IS NULL), 'Hobbies', 3, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Entertainment & Eating Out' AND `parent_id` IS NULL), 'Dining Out & Takeaways', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Entertainment & Eating Out' AND `parent_id` IS NULL), 'Cinema & Events', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Entertainment & Eating Out' AND `parent_id` IS NULL), 'Holidays & Day Trips', 2, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Entertainment & Eating Out' AND `parent_id` IS NULL), 'Subscriptions & Streaming', 3, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Gifts & Donations' AND `parent_id` IS NULL), 'Gifts', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Gifts & Donations' AND `parent_id` IS NULL), 'Charity', 1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
--> statement-breakpoint
INSERT INTO `categories` (`parent_id`, `name`, `sort_order`, `created_at`, `updated_at`, `version`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Other' AND `parent_id` IS NULL), 'Uncategorised', 0, (CAST(strftime('%s', 'now') AS INTEGER) * 1000), (CAST(strftime('%s', 'now') AS INTEGER) * 1000), 1);
