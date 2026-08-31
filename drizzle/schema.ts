import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  /** Firebase UID returned from Firebase Authentication. Unique per user. */
  firebaseUid: varchar("firebaseUid", { length: 128 }).unique(),
  /** Employee normalized phone number in E.164 format. */
  phoneE164: varchar("phoneE164", { length: 20 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "manager", "employee"]).default("employee").notNull(),
  accountStatus: mysqlEnum("accountStatus", ["invited", "active", "suspended", "removed"]).default("active").notNull(),
  /** Configured daily wage in INR (₹). Default is 0 until set by admin/manager. */
  dailyWage: int("dailyWage").default(0).notNull(),
  /** Assigned manager ID for team-based scoping. */
  managerId: int("managerId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Historical wage rate records with effective dates for payroll accuracy.
 */
export const employeeWages = mysqlTable("employee_wages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId")
    .references(() => users.id)
    .notNull(),
  dailyWage: int("dailyWage").notNull(),
  effectiveFrom: timestamp("effectiveFrom").notNull(),
  effectiveTo: timestamp("effectiveTo"),
  createdByUserOpenId: varchar("createdByUserOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmployeeWage = typeof employeeWages.$inferSelect;
export type InsertEmployeeWage = typeof employeeWages.$inferInsert;

/**
 * Server-side verified attendance records.
 */
export const attendanceRecords = mysqlTable("attendance_records", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId")
    .references(() => users.id)
    .notNull(),
  checkInAt: timestamp("checkInAt").notNull(),
  checkOutAt: timestamp("checkOutAt"),
  status: mysqlEnum("status", ["verified", "review", "pending"]).default("verified").notNull(),
  checkInPhotoUri: text("checkInPhotoUri"),
  checkOutPhotoUri: text("checkOutPhotoUri"),
  checkInLat: varchar("checkInLat", { length: 32 }),
  checkInLng: varchar("checkInLng", { length: 32 }),
  checkInAccuracy: int("checkInAccuracy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DbAttendanceRecord = typeof attendanceRecords.$inferSelect;
export type InsertDbAttendanceRecord = typeof attendanceRecords.$inferInsert;

/**
 * Account invitations managed by administrators.
 */
export const accountInvitations = mysqlTable("account_invitations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organizationId", { length: 64 }).default("default-org").notNull(),
  userId: int("userId").references(() => users.id),
  phoneE164: varchar("phoneE164", { length: 20 }).notNull(),
  role: mysqlEnum("role", ["admin", "manager", "employee"]).default("employee").notNull(),
  status: mysqlEnum("status", ["pending", "issued", "consumed", "expired", "cancelled"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  issuedAt: timestamp("issuedAt"),
  consumedAt: timestamp("consumedAt"),
  createdByUserOpenId: varchar("createdByUserOpenId", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AccountInvitation = typeof accountInvitations.$inferSelect;
export type InsertAccountInvitation = typeof accountInvitations.$inferInsert;

/**
 * Immutable audit logs tracking user lifecycle and administrative actions.
 */
export const auditEvents = mysqlTable("audit_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organizationId", { length: 64 }).default("default-org").notNull(),
  actorUserOpenId: varchar("actorUserOpenId", { length: 64 }).notNull(),
  subjectUserOpenId: varchar("subjectUserOpenId", { length: 64 }),
  action: varchar("action", { length: 128 }).notNull(),
  detail: text("detail"),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
});

export type AuditEvent = typeof auditEvents.$inferSelect;

/**
 * Outbox to queue asynchronous tasks (like Firebase disables or notifications) safely out-of-transaction.
 */
export const accountActionOutbox = mysqlTable("account_action_outbox", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organizationId", { length: 64 }).default("default-org").notNull(),
  userOpenId: varchar("userOpenId", { length: 64 }).notNull(),
  action: mysqlEnum("action", ["firebase_disable", "firebase_enable", "firebase_revoke_tokens", "notify_access_issued"]).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).unique().notNull(),
  status: mysqlEnum("status", ["pending", "processing", "delivered", "failed"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  availableAt: timestamp("availableAt").defaultNow().notNull(),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AccountActionOutbox = typeof accountActionOutbox.$inferSelect;

/**
 * Tasks / Work Orders assigned by Admins and Managers to Field Workers.
 */
export const tasks = mysqlTable("tasks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  assignedToUserId: int("assignedToUserId")
    .references(() => users.id)
    .notNull(),
  assignedByUserId: int("assignedByUserId")
    .references(() => users.id)
    .notNull(),
  scheduledDate: varchar("scheduledDate", { length: 10 }).notNull(), // YYYY-MM-DD
  priority: mysqlEnum("priority", ["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM").notNull(),
  status: mysqlEnum("status", ["PENDING", "IN_PROGRESS", "COMPLETED"]).default("PENDING").notNull(),
  locationLat: varchar("locationLat", { length: 32 }),
  locationLng: varchar("locationLng", { length: 32 }),
  locationAddress: text("locationAddress"),
  customerName: varchar("customerName", { length: 255 }),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbTask = typeof tasks.$inferSelect;
export type InsertDbTask = typeof tasks.$inferInsert;

/**
 * High-precision GPS waypoints for day-wise route playback and tracking history.
 */
export const gpsPoints = mysqlTable("gps_points", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId")
    .references(() => users.id)
    .notNull(),
  recordedDate: varchar("recordedDate", { length: 10 }).notNull(), // YYYY-MM-DD
  latitude: varchar("latitude", { length: 32 }).notNull(),
  longitude: varchar("longitude", { length: 32 }).notNull(),
  accuracy: int("accuracy"),
  address: text("address"),
  recordedAt: timestamp("recordedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DbGpsPoint = typeof gpsPoints.$inferSelect;
export type InsertDbGpsPoint = typeof gpsPoints.$inferInsert;
