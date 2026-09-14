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
  sessionVersion: int("sessionVersion").default(1).notNull(),
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

/**
 * Customers and client locations managed across the workforce.
 */
export const customers = mysqlTable("customers", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  latitude: varchar("latitude", { length: 32 }),
  longitude: varchar("longitude", { length: 32 }),
  notes: text("notes"),
  createdByUserId: int("createdByUserId").references(() => users.id),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbCustomer = typeof customers.$inferSelect;
export type InsertDbCustomer = typeof customers.$inferInsert;

/**
 * Customer visits and field appointments with evidence.
 */
export const visits = mysqlTable("visits", {
  id: varchar("id", { length: 36 }).primaryKey(),
  customerId: varchar("customerId", { length: 36 })
    .references(() => customers.id)
    .notNull(),
  employeeUserId: int("employeeUserId")
    .references(() => users.id)
    .notNull(),
  scheduledFor: timestamp("scheduledFor").notNull(),
  status: mysqlEnum("status", ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).default("SCHEDULED").notNull(),
  checkInAt: timestamp("checkInAt"),
  checkOutAt: timestamp("checkOutAt"),
  checkInLat: varchar("checkInLat", { length: 32 }),
  checkInLng: varchar("checkInLng", { length: 32 }),
  checkOutLat: varchar("checkOutLat", { length: 32 }),
  checkOutLng: varchar("checkOutLng", { length: 32 }),
  meetingOutcome: text("meetingOutcome"),
  notes: text("notes"),
  followUpDate: varchar("followUpDate", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbVisit = typeof visits.$inferSelect;
export type InsertDbVisit = typeof visits.$inferInsert;

/**
 * Evidence photos and geotags captured during customer visits.
 */
export const visitEvidence = mysqlTable("visit_evidence", {
  id: varchar("id", { length: 36 }).primaryKey(),
  visitId: varchar("visitId", { length: 36 })
    .references(() => visits.id)
    .notNull(),
  evidenceUrl: text("evidenceUrl").notNull(),
  latitude: varchar("latitude", { length: 32 }),
  longitude: varchar("longitude", { length: 32 }),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DbVisitEvidence = typeof visitEvidence.$inferSelect;
export type InsertDbVisitEvidence = typeof visitEvidence.$inferInsert;

/**
 * Direct and team chat channels between managers and field workers.
 */
export const chatChannels = mysqlTable("chat_channels", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 255 }),
  type: mysqlEnum("type", ["direct", "team"]).default("direct").notNull(),
  managerUserId: int("managerUserId").references(() => users.id),
  employeeUserId: int("employeeUserId").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DbChatChannel = typeof chatChannels.$inferSelect;
export type InsertDbChatChannel = typeof chatChannels.$inferInsert;

/**
 * Individual chat messages stored authoritatively in MySQL.
 */
export const chatMessages = mysqlTable("chat_messages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  channelId: varchar("channelId", { length: 36 })
    .references(() => chatChannels.id)
    .notNull(),
  senderUserId: int("senderUserId")
    .references(() => users.id)
    .notNull(),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["sent", "delivered", "read"]).default("sent").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DbChatMessage = typeof chatMessages.$inferSelect;
export type InsertDbChatMessage = typeof chatMessages.$inferInsert;

/**
 * Field expense claims and approvals.
 */
export const expenses = mysqlTable("expenses", {
  id: varchar("id", { length: 36 }).primaryKey(),
  employeeUserId: int("employeeUserId")
    .references(() => users.id)
    .notNull(),
  amount: int("amount").notNull(), // Amount in INR (₹)
  category: varchar("category", { length: 64 }).notNull(),
  description: text("description"),
  receiptUrl: text("receiptUrl"),
  expenseDate: varchar("expenseDate", { length: 10 }).notNull(), // YYYY-MM-DD
  status: mysqlEnum("status", ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]).default("SUBMITTED").notNull(),
  approvedByUserId: int("approvedByUserId").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DbExpense = typeof expenses.$inferSelect;
export type InsertDbExpense = typeof expenses.$inferInsert;

/**
 * Device tokens and active sessions for push notifications and device tracking.
 */
export const deviceSessions = mysqlTable("device_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId")
    .references(() => users.id)
    .notNull(),
  expoPushToken: varchar("expoPushToken", { length: 255 }),
  deviceModel: varchar("deviceModel", { length: 128 }),
  osVersion: varchar("osVersion", { length: 64 }),
  appVersion: varchar("appVersion", { length: 32 }),
  lastActiveAt: timestamp("lastActiveAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DbDeviceSession = typeof deviceSessions.$inferSelect;
export type InsertDbDeviceSession = typeof deviceSessions.$inferInsert;

/**
 * Persistent notifications sent to employees and managers.
 */
export const notifications = mysqlTable("notifications", {
  id: varchar("id", { length: 36 }).primaryKey(),
  recipientUserId: int("recipientUserId")
    .references(() => users.id)
    .notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  type: varchar("type", { length: 64 }).default("general").notNull(),
  dataJson: text("dataJson"),
  read: int("read").default(0).notNull(), // 0: unread, 1: read
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DbNotification = typeof notifications.$inferSelect;
export type InsertDbNotification = typeof notifications.$inferInsert;

