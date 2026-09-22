ALTER TABLE `schedules` ADD `supplier_id` integer REFERENCES `suppliers`(`id`);--> statement-breakpoint
CREATE INDEX `schedules_supplier_idx` ON `schedules` (`supplier_id`);
