ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `tokenVersion` int NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD `operationId` varchar(128);--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_operationId_unique` UNIQUE(`operationId`);--> statement-breakpoint
ALTER TABLE `attendance_records` ADD `geofenceStatus` enum('inside','outside','unverified') NOT NULL DEFAULT 'unverified';--> statement-breakpoint
ALTER TABLE `attendance_records` ADD `distanceMeters` int;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD `clientCheckInAt` timestamp;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD `clientCheckOutAt` timestamp;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD `reviewedByUserId` int;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD `reviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD `reviewNotes` text;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_reviewedByUserId_users_id_fk` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gps_points` ADD `operationId` varchar(128);--> statement-breakpoint
ALTER TABLE `gps_points` ADD CONSTRAINT `gps_points_operationId_unique` UNIQUE(`operationId`);--> statement-breakpoint
ALTER TABLE `gps_points` ADD `capturedAt` timestamp;--> statement-breakpoint
ALTER TABLE `tasks` ADD `operationId` varchar(128);--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_operationId_unique` UNIQUE(`operationId`);--> statement-breakpoint
ALTER TABLE `customers` ADD `operationId` varchar(128);--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_operationId_unique` UNIQUE(`operationId`);--> statement-breakpoint
ALTER TABLE `visits` ADD `operationId` varchar(128);--> statement-breakpoint
ALTER TABLE `visits` ADD CONSTRAINT `visits_operationId_unique` UNIQUE(`operationId`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `operationId` varchar(128);--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_operationId_unique` UNIQUE(`operationId`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `operationId` varchar(128);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_operationId_unique` UNIQUE(`operationId`);--> statement-breakpoint
ALTER TABLE `visit_evidence` ADD `operationId` varchar(128);--> statement-breakpoint
ALTER TABLE `visit_evidence` ADD CONSTRAINT `visit_evidence_operationId_unique` UNIQUE(`operationId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `userId` int NOT NULL,
  `operationType` varchar(64) NOT NULL,
  `operationId` varchar(128) NOT NULL,
  `recordId` varchar(64),
  `responsePayload` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `idempotency_keys_operationId_unique` UNIQUE(`operationId`),
  CONSTRAINT `idempotency_keys_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
