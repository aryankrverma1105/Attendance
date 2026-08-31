ALTER TABLE `users` ADD `dailyWage` int NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `managerId` int;--> statement-breakpoint
CREATE TABLE `employee_wages` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`dailyWage` int NOT NULL,
	`effectiveFrom` timestamp NOT NULL,
	`effectiveTo` timestamp,
	`createdByUserOpenId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_wages_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_wages_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE `attendance_records` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`checkInAt` timestamp NOT NULL,
	`checkOutAt` timestamp,
	`status` enum('verified','review','pending') NOT NULL DEFAULT 'verified',
	`checkInPhotoUri` text,
	`checkOutPhotoUri` text,
	`checkInLat` varchar(32),
	`checkInLng` varchar(32),
	`checkInAccuracy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `attendance_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_records_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action
);
