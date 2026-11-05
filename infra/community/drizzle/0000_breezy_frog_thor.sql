CREATE TABLE `community_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`suggestion_id` text,
	`kind` text NOT NULL,
	`input` text NOT NULL,
	`scenario` text NOT NULL,
	`status` text NOT NULL,
	`reply` text,
	`proposals` text,
	`error` text,
	`lease_token` text,
	`lease_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`idempotency` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_dedupe` ON `community_jobs` (`session_id`,`kind`,`idempotency`);--> statement-breakpoint
CREATE INDEX `job_queue` ON `community_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `community_rate` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_relay` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_sessions_token_hash_unique` ON `community_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `community_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`text` text NOT NULL,
	`species` text NOT NULL,
	`scenario` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`task_id` text,
	`error` text,
	`deployment_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`idempotency` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_dedupe` ON `community_suggestions` (`session_id`,`idempotency`);