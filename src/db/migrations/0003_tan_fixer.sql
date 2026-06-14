PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scheduled_post` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`storage_keys` text NOT NULL,
	`caption` text NOT NULL,
	`scheduled_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`ig_media_id` text,
	`permalink` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_post`("id", "user_id", "storage_keys", "caption", "scheduled_at", "status", "attempts", "error", "ig_media_id", "permalink", "created_at", "updated_at") SELECT "id", "user_id", "storage_keys", "caption", "scheduled_at", "status", "attempts", "error", "ig_media_id", "permalink", "created_at", "updated_at" FROM `scheduled_post`;--> statement-breakpoint
DROP TABLE `scheduled_post`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_post` RENAME TO `scheduled_post`;--> statement-breakpoint
PRAGMA foreign_keys=ON;