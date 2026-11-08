CREATE TABLE `hook_template_instances` (
	`template_id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`agent` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`custom_content` text,
	`last_validation_status` text DEFAULT 'not_validated' NOT NULL,
	`last_validation_message` text,
	`last_validation_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hook_templates_agent` ON `hook_template_instances` (`agent`);