CREATE TABLE `account_action_outbox` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(64) NOT NULL DEFAULT 'default-org',
	`userOpenId` varchar(64) NOT NULL,
	`action` enum('firebase_disable','firebase_enable','firebase_revoke_tokens','notify_access_issued') NOT NULL,
	`idempotencyKey` varchar(128) NOT NULL,
	`status` enum('pending','processing','delivered','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`availableAt` timestamp NOT NULL DEFAULT (now()),
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `account_action_outbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_action_outbox_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `account_invitations` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(64) NOT NULL DEFAULT 'default-org',
	`userId` int,
	`phoneE164` varchar(20) NOT NULL,
	`role` enum('admin','manager','employee') NOT NULL DEFAULT 'employee',
	`status` enum('pending','issued','consumed','expired','cancelled') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`issuedAt` timestamp,
	`consumedAt` timestamp,
	`createdByUserOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `account_invitations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(64) NOT NULL DEFAULT 'default-org',
	`actorUserOpenId` varchar(64) NOT NULL,
	`subjectUserOpenId` varchar(64),
	`action` varchar(128) NOT NULL,
	`detail` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','manager','employee') NOT NULL DEFAULT 'employee';--> statement-breakpoint
ALTER TABLE `users` ADD `firebaseUid` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `phoneE164` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `accountStatus` enum('invited','active','suspended','removed') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_firebaseUid_unique` UNIQUE(`firebaseUid`);--> statement-breakpoint
ALTER TABLE `account_invitations` ADD CONSTRAINT `account_invitations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;