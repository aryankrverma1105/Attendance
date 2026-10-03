CREATE TABLE IF NOT EXISTS `sites` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`geofence_radius_m` double NOT NULL DEFAULT 100,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `sites_id` PRIMARY KEY(`id`)
);
