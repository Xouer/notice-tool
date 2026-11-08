ALTER TABLE `task_events` ADD `event_key` text;--> statement-breakpoint
CREATE INDEX `idx_task_events_event_key_dedup` ON `task_events` (`source_agent`,`task_id`,`event_key`,`received_at`);