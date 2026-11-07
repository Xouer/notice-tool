CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`credentials_blob` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`rate_limit` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_channels_type_name` ON `notification_channels` (`type`,`name`);--> statement-breakpoint
CREATE TABLE `notification_records` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`channel_id` text,
	`template_id` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `task_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `notification_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_records_event` ON `notification_records` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_records_status` ON `notification_records` (`status`);--> statement-breakpoint
CREATE INDEX `idx_records_channel` ON `notification_records` (`channel_id`);--> statement-breakpoint
CREATE TABLE `notification_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`channel_type` text,
	`body` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_templates_name_unique` ON `notification_templates` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_templates_default_per_channel` ON `notification_templates` (`channel_type`) WHERE is_default = 1;--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_agent` text NOT NULL,
	`task_id` text NOT NULL,
	`finished_at` integer NOT NULL,
	`result_status` text NOT NULL,
	`trigger_type` text NOT NULL,
	`raw_payload_ref` text,
	`received_at` integer NOT NULL,
	`notify_status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_events_dedup` ON `task_events` (`source_agent`,`task_id`,`received_at`);