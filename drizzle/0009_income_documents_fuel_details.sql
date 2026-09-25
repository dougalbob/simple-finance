CREATE TABLE `__new_attachments` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `purchase_id` integer, `receipt_id` integer, `file_key` text NOT NULL UNIQUE, `original_name` text NOT NULL, `mime` text NOT NULL, `size_bytes` integer NOT NULL, `sha256` text NOT NULL, `state` text NOT NULL DEFAULT 'stored', `created_by` text NOT NULL, `created_at` integer NOT NULL, FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade, CONSTRAINT `attachments_one_owner` CHECK ((`purchase_id` IS NULL) != (`receipt_id` IS NULL)));--> statement-breakpoint
INSERT INTO `__new_attachments` (`id`, `purchase_id`, `receipt_id`, `file_key`, `original_name`, `mime`, `size_bytes`, `sha256`, `state`, `created_by`, `created_at`) SELECT `id`, `purchase_id`, NULL, `file_key`, `original_name`, `mime`, `size_bytes`, `sha256`, `state`, `created_by`, `created_at` FROM `attachments`;--> statement-breakpoint
DROP TABLE `attachments`;--> statement-breakpoint
ALTER TABLE `__new_attachments` RENAME TO `attachments`;--> statement-breakpoint
CREATE INDEX `attachments_purchase_idx` ON `attachments` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `attachments_receipt_idx` ON `attachments` (`receipt_id`);--> statement-breakpoint
ALTER TABLE `purchases` ADD `odometer_miles` integer CHECK (`odometer_miles` IS NULL OR `odometer_miles` > 0);--> statement-breakpoint
ALTER TABLE `purchases` ADD `fuel_millilitres` integer CHECK (`fuel_millilitres` IS NULL OR `fuel_millilitres` > 0);--> statement-breakpoint
ALTER TABLE `purchases` ADD `fuel_full_tank` integer DEFAULT 1 NOT NULL CHECK (`fuel_full_tank` IN (0, 1));
