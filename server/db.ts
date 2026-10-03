import dotenv from "dotenv";
dotenv.config();

import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  accountActionOutbox,
  accountInvitations,
  attendanceRecords,
  auditEvents,
  chatChannels,
  DbChatChannel,
  chatMessages,
  DbChatMessage,
  customers,
  DbCustomer,
  deviceSessions,
  DbDeviceSession,
  employeeWages,
  EmployeeWage,
  expenses,
  DbExpense,
  gpsPoints,
  DbGpsPoint,
  notifications,
  DbNotification,
  tasks,
  DbTask,
  InsertUser,
  User,
  users,
  visitEvidence,
  DbVisitEvidence,
  visits,
  DbVisit,
  InsertDbVisit,
  sites,
  DbSite,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

import mysql from "mysql2";

let _pool: mysql.Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance with resilient connection pool.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const isProd = process.env.NODE_ENV === "production";
      const useSsl = process.env.DATABASE_SSL === "true";
      
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
        waitForConnections: true,
        queueLimit: 0,
        connectTimeout: 10000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        ssl: useSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_STRICT === "true" } : undefined,
      });

      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByFirebaseUid(firebaseUid: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by Firebase UID: database not available");
    return undefined;
  }
  const result = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getActiveInvitationByPhone(phoneE164: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot check invitation: database not available");
    return undefined;
  }
  const result = await db
    .select()
    .from(accountInvitations)
    .where(and(eq(accountInvitations.phoneE164, phoneE164), eq(accountInvitations.status, "pending")))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function activateUserFromInvitation(
  invitationId: string,
  firebaseUid: string,
  phoneE164: string,
  name: string,
  role: "admin" | "manager" | "employee",
) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot activate user: database not available");
    return undefined;
  }

  return await db.transaction(async (tx) => {
    const openId = `firebase_${firebaseUid}`;
    const signedInAt = new Date();

    const existing = await tx.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
    let userId: number;

    if (existing.length > 0) {
      userId = existing[0].id;
      await tx
        .update(users)
        .set({
          phoneE164,
          name,
          role,
          accountStatus: "active",
          lastSignedIn: signedInAt,
        })
        .where(eq(users.id, userId));
    } else {
      const [insertResult] = await tx.insert(users).values({
        openId,
        firebaseUid,
        phoneE164,
        name,
        role,
        accountStatus: "active",
        lastSignedIn: signedInAt,
      });
      userId = insertResult.insertId;
    }

    await tx
      .update(accountInvitations)
      .set({
        status: "consumed",
        userId,
        consumedAt: signedInAt,
      })
      .where(eq(accountInvitations.id, invitationId));

    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await tx.insert(auditEvents).values({
      id: auditId,
      actorUserOpenId: openId,
      subjectUserOpenId: openId,
      action: "account.activated_after_phone_otp",
      detail: `Activated account for phone ${phoneE164} via invitation ${invitationId}`,
    });

    const activeUser = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return activeUser[0];
  });
}

export async function seedSuperAdmin(): Promise<void> {
  const superAdminPhone = process.env.SUPER_ADMIN_PHONE;
  if (!superAdminPhone) return;

  let cleanPhone = superAdminPhone.trim();
  if (/^\d{10}$/.test(cleanPhone)) {
    cleanPhone = `+91${cleanPhone}`;
  } else if (!cleanPhone.startsWith("+")) {
    cleanPhone = `+${cleanPhone}`;
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot seed super admin: DB unavailable");
    return;
  }

  try {
    const existing = await db.select().from(users).where(eq(users.phoneE164, cleanPhone)).limit(1);
    if (existing.length === 0) {
      console.log(`[Database] Seeding super admin with phone ${cleanPhone}...`);
      await db.insert(users).values({
        openId: `admin_${cleanPhone.replace(/[^0-9]/g, "")}`,
        phoneE164: cleanPhone,
        name: "Super Admin",
        role: "admin",
        accountStatus: "active",
        tokenVersion: 1,
      });
      console.log(`[Database] Super admin seeded successfully.`);
    } else if (existing[0].role !== "admin") {
      await db.update(users).set({ role: "admin", accountStatus: "active" }).where(eq(users.id, existing[0].id));
      console.log(`[Database] Promoted existing user ${cleanPhone} to admin.`);
    }
  } catch (err) {
    console.error("[Database] Failed to seed super admin:", err);
  }
}

export async function autoActivateUser(firebaseUid: string, phoneE164: string, name: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable");
  }

  let cleanPhone = phoneE164.trim();
  if (/^\d{10}$/.test(cleanPhone)) {
    cleanPhone = `+91${cleanPhone}`;
  } else if (!cleanPhone.startsWith("+")) {
    cleanPhone = `+${cleanPhone}`;
  }

  return await db.transaction(async (tx) => {
    const openId = `firebase_${firebaseUid}`;
    const signedInAt = new Date();

    // 1. Check existing by firebaseUid
    const existingByUid = await tx.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
    if (existingByUid.length > 0) {
      const u = existingByUid[0];
      if (u.accountStatus === "suspended" || u.accountStatus === "removed") {
        throw new Error("Account has been suspended or removed. Please contact your administrator.");
      }
      return u;
    }

    // 2. Check existing pre-created user by phone number
    const existingByPhone = await tx.select().from(users).where(eq(users.phoneE164, cleanPhone)).limit(1);
    if (existingByPhone.length > 0) {
      const u = existingByPhone[0];
      if (u.accountStatus === "suspended" || u.accountStatus === "removed") {
        throw new Error("Account has been suspended or removed. Please contact your administrator.");
      }
      await tx
        .update(users)
        .set({
          firebaseUid,
          accountStatus: "active",
          lastSignedIn: signedInAt,
        })
        .where(eq(users.id, u.id));
      const updated = await tx.select().from(users).where(eq(users.id, u.id)).limit(1);
      return updated[0];
    }

    // 3. Check pending invitation
    const pendingInvites = await tx
      .select()
      .from(accountInvitations)
      .where(and(eq(accountInvitations.phoneE164, cleanPhone), eq(accountInvitations.status, "pending")))
      .limit(1);

    if (pendingInvites.length > 0) {
      const invite = pendingInvites[0];
      const [insertResult] = await tx.insert(users).values({
        openId,
        firebaseUid,
        phoneE164: cleanPhone,
        name: name || "Employee",
        role: invite.role,
        accountStatus: "active",
        lastSignedIn: signedInAt,
        tokenVersion: 1,
      });
      const userId = insertResult.insertId;

      await tx
        .update(accountInvitations)
        .set({
          status: "consumed",
          userId,
          consumedAt: signedInAt,
        })
        .where(eq(accountInvitations.id, invite.id));

      const activeUser = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      return activeUser[0];
    }

    // Strictly do NOT create arbitrary users or make the first user admin!
    throw new Error("No pre-created account or pending invitation found for this phone number. Please contact an administrator.");
  });
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getAllUsers(): Promise<User[]> {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(users);
}

export async function getUsersByManagerId(managerId: number): Promise<User[]> {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(users).where(eq(users.managerId, managerId));
}

/**
 * Updates an employee's daily wage with server-side RBAC validation,
 * recording an immutable history record and audit log.
 */
export async function updateUserDailyWage(
  actorOpenId: string,
  actorRole: string,
  actorId: number,
  targetUserId: number,
  newDailyWage: number
): Promise<{ success: boolean; updatedWage: number; message?: string }> {
  if (newDailyWage < 0 || newDailyWage > 100000) {
    throw new Error("Invalid daily wage amount. Must be between 0 and 100,000 INR.");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable");
  }

  const targetUser = await getUserById(targetUserId);
  if (!targetUser) {
    throw new Error("Target employee not found");
  }

  // RBAC validation: STRICT RULE: Only Admin can modify employee daily wages.
  if (actorRole !== "admin") {
    throw new Error("Forbidden: Only Administrators are authorized to set or modify employee daily wages.");
  }

  return await db.transaction(async (tx) => {
    const now = new Date();

    // Close any previous open-ended wage record
    const openWages = await tx
      .select()
      .from(employeeWages)
      .where(and(eq(employeeWages.userId, targetUserId), sql`${employeeWages.effectiveTo} IS NULL`));

    for (const wageRecord of openWages) {
      await tx
        .update(employeeWages)
        .set({ effectiveTo: now })
        .where(eq(employeeWages.id, wageRecord.id));
    }

    // Insert new wage history record
    const wageHistoryId = `wage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await tx.insert(employeeWages).values({
      id: wageHistoryId,
      userId: targetUserId,
      dailyWage: newDailyWage,
      effectiveFrom: now,
      createdByUserOpenId: actorOpenId,
    });

    // Update current daily wage in users table
    await tx
      .update(users)
      .set({ dailyWage: newDailyWage, updatedAt: now })
      .where(eq(users.id, targetUserId));

    // Create audit event
    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await tx.insert(auditEvents).values({
      id: auditId,
      actorUserOpenId: actorOpenId,
      subjectUserOpenId: targetUser.openId,
      action: "employee.wage_updated",
      detail: `Updated daily wage for employee ${targetUser.name || targetUserId} from ₹${targetUser.dailyWage} to ₹${newDailyWage}`,
    });

    return { success: true, updatedWage: newDailyWage };
  });
}

/**
 * Returns date formatted as YYYY-MM-DD in Asia/Kolkata time zone.
 */
export function formatKolkataDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Calculates server-side verified worked days (count of unique calendar dates with verified/approved check-in in Asia/Kolkata)
 * and earnings for a given month and year.
 */
export async function getEmployeeWorkedDaysAndEarnings(
  userId: number,
  year: number,
  month: number // 1-12
): Promise<{
  workedDays: number;
  dailyWage: number;
  calculatedEarnings: number;
  workedDates: string[];
}> {
  const db = await getDb();
  const targetUser = await getUserById(userId);
  const currentWage = targetUser?.dailyWage ?? 0;

  if (!db) {
    return {
      workedDays: 0,
      dailyWage: currentWage,
      calculatedEarnings: 0,
      workedDates: [],
    };
  }

  // Cover entire month with padding for Asia/Kolkata (UTC+5:30)
  const startRange = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - 24 * 3600 * 1000);
  const endRange = new Date(Date.UTC(year, month, 1, 23, 59, 59) + 24 * 3600 * 1000);

  // Fetch attendance records within the date range
  const records = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.userId, userId),
        or(eq(attendanceRecords.status, "verified"), eq(attendanceRecords.status, "review")),
        gte(attendanceRecords.checkInAt, startRange),
        lte(attendanceRecords.checkInAt, endRange)
      )
    );

  // Payroll counts verified/approved records
  const validRecords = records.filter((r) => r.status === "verified");

  // Count unique calendar dates (YYYY-MM-DD) in Asia/Kolkata
  const uniqueDatesSet = new Set<string>();
  const targetMonthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  validRecords.forEach((r) => {
    const dateStr = formatKolkataDate(new Date(r.checkInAt));
    if (dateStr.startsWith(targetMonthPrefix)) {
      uniqueDatesSet.add(dateStr);
    }
  });

  const workedDates = Array.from(uniqueDatesSet).sort();
  const workedDays = workedDates.length;

  // Check if historical wages exist for this period
  const wageHistory = await db
    .select()
    .from(employeeWages)
    .where(eq(employeeWages.userId, userId))
    .orderBy(desc(employeeWages.effectiveFrom));

  let totalEarnings = 0;
  if (wageHistory.length === 0) {
    totalEarnings = workedDays * currentWage;
  } else {
    // Calculate for each worked date based on effective wage on that date
    for (const dateStr of workedDates) {
      const workedDate = new Date(dateStr + "T12:00:00+05:30");
      const effectiveWageRecord = wageHistory.find(
        (w) => w.effectiveFrom <= workedDate && (!w.effectiveTo || w.effectiveTo >= workedDate)
      );
      const applicableWage = effectiveWageRecord ? effectiveWageRecord.dailyWage : currentWage;
      totalEarnings += applicableWage;
    }
  }

  return {
    workedDays,
    dailyWage: currentWage,
    calculatedEarnings: totalEarnings,
    workedDates,
  };
}

/**
 * Creates a new user ID directly by an authenticated Administrator with a phone number.
 */
export async function createUserByAdmin(
  actorUser: User,
  input: {
    name: string;
    phoneE164: string;
    role: "admin" | "manager" | "employee";
    department?: string;
    dailyWage?: number;
    managerId?: number;
  }
): Promise<{ success: boolean; user: User }> {
  if (actorUser.role !== "admin") {
    throw new Error("Forbidden: Only Administrators are authorized to create new accounts.");
  }

  // Validate phone format
  let cleanPhone = input.phoneE164.trim();
  if (/^\d{10}$/.test(cleanPhone)) {
    cleanPhone = `+91${cleanPhone}`;
  } else if (!cleanPhone.startsWith("+")) {
    cleanPhone = `+${cleanPhone}`;
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database is currently unavailable.");
  }

  // Check for duplicate phone number
  const existing = await db.select().from(users).where(eq(users.phoneE164, cleanPhone)).limit(1);
  if (existing.length > 0) {
    throw new Error(`An account with phone number ${cleanPhone} already exists.`);
  }

  return await db.transaction(async (tx) => {
    const openId = `phone_${cleanPhone.replace(/[^0-9]/g, "")}_${Date.now()}`;
    const initialWage = input.role === "employee" ? Math.max(0, input.dailyWage || 0) : 0;
    const assignedManagerId = input.role === "employee" ? input.managerId || null : null;

    const [insertResult] = await tx.insert(users).values({
      openId,
      phoneE164: cleanPhone,
      name: input.name.trim(),
      role: input.role,
      accountStatus: "active",
      dailyWage: initialWage,
      managerId: assignedManagerId,
      loginMethod: "firebase",
    });

    const userId = insertResult.insertId;

    if (initialWage > 0 && input.role === "employee") {
      const wageHistoryId = `wage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await tx.insert(employeeWages).values({
        id: wageHistoryId,
        userId,
        dailyWage: initialWage,
        effectiveFrom: new Date(),
        createdByUserOpenId: actorUser.openId,
      });
    }

    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await tx.insert(auditEvents).values({
      id: auditId,
      actorUserOpenId: actorUser.openId,
      subjectUserOpenId: openId,
      action: "account.created_by_admin",
      detail: `Created ${input.role} account for ${input.name} (${cleanPhone})`,
    });

    const createdUser = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return { success: true, user: createdUser[0] };
  });
}

/**
 * Task Assignment System
 */
export async function createTask(
  actorUser: User,
  input: {
    title: string;
    description?: string;
    assignedToUserId: number;
    scheduledDate: string; // YYYY-MM-DD
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    locationLat?: string;
    locationLng?: string;
    locationAddress?: string;
    customerName?: string;
    operationId?: string;
  }
): Promise<DbTask> {
  if (actorUser.role !== "admin" && actorUser.role !== "manager") {
    throw new Error("Forbidden: Only Administrators and Managers can assign tasks.");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable.");
  }

  if (input.operationId) {
    const existingOp = await db.select().from(tasks).where(eq(tasks.operationId, input.operationId)).limit(1);
    if (existingOp.length > 0) {
      return existingOp[0];
    }
  }

  const targetUser = await getUserById(input.assignedToUserId);
  if (!targetUser) {
    throw new Error("Assigned employee not found.");
  }
  if (targetUser.role !== "employee") {
    throw new Error("Tasks can only be assigned to field employees.");
  }

  // Manager scoping check: Manager can only assign tasks to their assigned team
  if (actorUser.role === "manager" && targetUser.managerId !== actorUser.id) {
    throw new Error("Forbidden: Managers can only assign tasks to employees in their own team.");
  }

  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(tasks).values({
    id: taskId,
    title: input.title.trim(),
    description: input.description?.trim(),
    assignedToUserId: input.assignedToUserId,
    assignedByUserId: actorUser.id,
    scheduledDate: input.scheduledDate,
    priority: input.priority,
    status: "PENDING",
    locationLat: input.locationLat,
    locationLng: input.locationLng,
    locationAddress: input.locationAddress,
    customerName: input.customerName,
    operationId: input.operationId || null,
  });

  const created = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return created[0];
}

export async function getTasksForUser(userId: number, date?: string): Promise<DbTask[]> {
  const db = await getDb();
  if (!db) return [];
  if (date) {
    return await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.assignedToUserId, userId), eq(tasks.scheduledDate, date)))
      .orderBy(desc(tasks.createdAt));
  }
  return await db
    .select()
    .from(tasks)
    .where(eq(tasks.assignedToUserId, userId))
    .orderBy(desc(tasks.createdAt));
}

export async function getAllTasks(date?: string): Promise<DbTask[]> {
  const db = await getDb();
  if (!db) return [];
  if (date) {
    return await db.select().from(tasks).where(eq(tasks.scheduledDate, date)).orderBy(desc(tasks.createdAt));
  }
  return await db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function getTasksByManagerId(managerId: number, date?: string): Promise<DbTask[]> {
  const db = await getDb();
  if (!db) return [];
  const teamMembers = await getUsersByManagerId(managerId);
  const memberIds = teamMembers.map((m) => m.id);
  if (memberIds.length === 0) return [];

  const all = await getAllTasks(date);
  return all.filter((t) => memberIds.includes(t.assignedToUserId) || t.assignedByUserId === managerId);
}

export async function updateTaskStatus(
  actorUser: User,
  taskId: string,
  newStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED"
): Promise<DbTask> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const existing = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (existing.length === 0) throw new Error("Task not found.");

  const task = existing[0];
  // Check permission:
  if (actorUser.role === "employee") {
    if (task.assignedToUserId !== actorUser.id) {
      throw new Error("Forbidden: You can only update tasks assigned to yourself.");
    }
  } else if (actorUser.role === "manager") {
    const targetUser = await getUserById(task.assignedToUserId);
    if (targetUser?.managerId !== actorUser.id && task.assignedByUserId !== actorUser.id) {
      throw new Error("Forbidden: Managers can only update tasks for their assigned team.");
    }
  }

  const updates: Partial<DbTask> = { status: newStatus };
  if (newStatus === "IN_PROGRESS" && !task.startedAt) {
    updates.startedAt = new Date();
  } else if (newStatus === "COMPLETED") {
    updates.completedAt = new Date();
  }

  await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
  const updated = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return updated[0];
}

/**
 * Day-Wise GPS Location History & Route Playback
 */
export async function recordGpsPoint(
  userId: number,
  point: {
    recordedDate: string; // YYYY-MM-DD
    latitude: string;
    longitude: string;
    accuracy?: number;
    address?: string;
    operationId?: string;
    capturedAt?: string | Date;
  }
): Promise<DbGpsPoint> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  if (point.operationId) {
    const existingOp = await db
      .select()
      .from(gpsPoints)
      .where(eq(gpsPoints.operationId, point.operationId))
      .limit(1);
    if (existingOp.length > 0) {
      return existingOp[0];
    }
  }

  const id = `gps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const capturedAtDate = point.capturedAt ? new Date(point.capturedAt) : new Date();

  await db.insert(gpsPoints).values({
    id,
    userId,
    recordedDate: point.recordedDate,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: point.accuracy,
    address: point.address,
    operationId: point.operationId || null,
    capturedAt: isNaN(capturedAtDate.getTime()) ? new Date() : capturedAtDate,
    recordedAt: new Date(),
  });

  const created = await db.select().from(gpsPoints).where(eq(gpsPoints.id, id)).limit(1);
  return created[0];
}

export async function getDayGpsHistory(
  actorUser: User,
  targetUserId: number,
  recordedDate: string // YYYY-MM-DD
): Promise<{
  date: string;
  targetUserId: number;
  targetUserName: string;
  pointsCount: number;
  points: DbGpsPoint[];
}> {
  const targetUser = await getUserById(targetUserId);
  if (!targetUser) throw new Error("Target user not found.");

  // RBAC Authorization check
  if (actorUser.role === "admin") {
    // Admin can view any user
  } else if (actorUser.role === "manager") {
    if (targetUser.managerId !== actorUser.id && targetUser.id !== actorUser.id) {
      throw new Error("Forbidden: Managers can only view GPS history for employees in their own team.");
    }
  } else {
    // Employee can only view own history
    if (actorUser.id !== targetUserId) {
      throw new Error("Forbidden: Employees can only view their own GPS history.");
    }
  }

  const db = await getDb();
  if (!db) {
    return {
      date: recordedDate,
      targetUserId,
      targetUserName: targetUser.name || "Employee",
      pointsCount: 0,
      points: [],
    };
  }

  const points = await db
    .select()
    .from(gpsPoints)
    .where(and(eq(gpsPoints.userId, targetUserId), eq(gpsPoints.recordedDate, recordedDate)))
    .orderBy(desc(gpsPoints.recordedAt));

  return {
    date: recordedDate,
    targetUserId,
    targetUserName: targetUser.name || "Employee",
    pointsCount: points.length,
    points,
  };
}

/**
 * Update user status, role, or manager assignment by Admin.
 * Soft-deactivates or updates without deleting historical data.
 */
export async function updateUserStatusByAdmin(
  actorUser: User,
  input: {
    targetUserId: number;
    accountStatus?: "active" | "suspended" | "removed";
    role?: "admin" | "manager" | "employee";
    managerId?: number | null;
  }
): Promise<{ success: boolean; user?: User }> {
  if (actorUser.role !== "admin") {
    throw new Error("Forbidden: Only Administrators can update user status and roles.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const targetUser = await getUserById(input.targetUserId);
  if (!targetUser) throw new Error("Target user not found.");

  const updates: Partial<User> = { updatedAt: new Date() };
  if (input.accountStatus) updates.accountStatus = input.accountStatus;
  if (input.role) updates.role = input.role;
  if (input.managerId !== undefined) updates.managerId = input.managerId;

  await db.update(users).set(updates).where(eq(users.id, input.targetUserId));

  // Create audit event
  const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(auditEvents).values({
    id: auditId,
    actorUserOpenId: actorUser.openId,
    subjectUserOpenId: targetUser.openId,
    action: input.accountStatus === "removed" ? "user.deactivated" : "user.status_updated",
    detail: `Updated user ${targetUser.name || targetUser.id} (${JSON.stringify(input)})`,
  });

  const updated = await getUserById(input.targetUserId);
  return { success: true, user: updated };
}

/**
 * Calculate distance between two GPS coordinates in meters using Haversine formula.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Server-side Attendance Verification System with Geofencing, Mock Detection & Idempotency.
 */
function validateClientTimestamp(tsStr?: string): Date | undefined {
  if (!tsStr) return undefined;
  const d = new Date(tsStr);
  if (isNaN(d.getTime())) return undefined;
  const now = Date.now();
  const diffMs = now - d.getTime();
  // Reject if more than 24h old
  if (diffMs > 24 * 60 * 60 * 1000) {
    throw new Error("Client timestamp is more than 24 hours old and cannot be accepted.");
  }
  // Reject if in the future (>5 minutes tolerance for minor clock skew)
  if (diffMs < -5 * 60 * 1000) {
    throw new Error("Client timestamp is in the future and cannot be accepted.");
  }
  return d;
}

/**
 * Server-side Attendance Verification System with Geofencing, Mock Detection & Idempotency.
 * The allowed work site is determined strictly from the database (sites, assigned tasks, customer visits, or office),
 * never from client-supplied targets.
 */
export async function recordAttendanceCheckIn(
  employeeUser: User,
  input: {
    checkInPhotoUri?: string;
    checkInLat?: string;
    checkInLng?: string;
    checkInAccuracy?: number;
    operationId?: string;
    clientCheckInAt?: string;
    isMocked?: boolean;
    // Client-supplied targetLat, targetLng, geofenceRadiusMeters are discarded for security.
  }
): Promise<any> {
  if (employeeUser.role !== "employee") {
    throw new Error("Forbidden: Attendance check-in is restricted exclusively to field employees.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  // 1. Idempotency Check: if operationId provided and matches existing, return existing record
  if (input.operationId) {
    const existingOp = await db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.operationId, input.operationId))
      .limit(1);
    if (existingOp.length > 0) {
      return existingOp[0];
    }
  }

  const validatedClientCheckIn = validateClientTimestamp(input.clientCheckInAt);
  const now = new Date();
  const effectiveCheckInAt = validatedClientCheckIn || now;

  // Prevent rapid duplicate check-ins within 30 seconds
  const recentRecords = await db
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.userId, employeeUser.id))
    .orderBy(desc(attendanceRecords.checkInAt))
    .limit(1);

  if (recentRecords.length > 0 && !recentRecords[0].checkOutAt) {
    const elapsedSec = (now.getTime() - new Date(recentRecords[0].checkInAt).getTime()) / 1000;
    if (elapsedSec < 30) {
      return recentRecords[0];
    }
  }

  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const MAX_GPS_ACCURACY_METERS = Number(process.env.MAX_GPS_ACCURACY_METERS) || 100;
  const DEFAULT_GEOFENCE_RADIUS_METERS = Number(process.env.DEFAULT_GEOFENCE_RADIUS_METERS) || 300;

  let isMockedFlag = input.isMocked ? 1 : 0;
  let status: "verified" | "review" | "pending" = "verified";

  if (input.checkInAccuracy && input.checkInAccuracy > MAX_GPS_ACCURACY_METERS) {
    status = "review";
  }
  if (isMockedFlag === 1) {
    status = "review";
  }

  // 2. Query allowed sites strictly from server DB:
  // - registered company sites in 'sites' table
  // - tasks assigned to employee with location coordinates
  // - scheduled customer visits with customer coordinates
  // - office coordinates from server environment if configured
  interface AllowedSite {
    name: string;
    lat: number;
    lng: number;
    radius: number;
  }
  const allowedSites: AllowedSite[] = [];

  const dbSites = await db.select().from(sites);
  for (const s of dbSites) {
    allowedSites.push({
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      radius: s.geofenceRadiusM || DEFAULT_GEOFENCE_RADIUS_METERS,
    });
  }

  const userTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.assignedToUserId, employeeUser.id), or(eq(tasks.status, "PENDING"), eq(tasks.status, "IN_PROGRESS"))));
  for (const t of userTasks) {
    if (t.locationLat && t.locationLng) {
      const lat = parseFloat(t.locationLat);
      const lng = parseFloat(t.locationLng);
      if (!isNaN(lat) && !isNaN(lng)) {
        allowedSites.push({
          name: t.title || "Assigned Task",
          lat,
          lng,
          radius: DEFAULT_GEOFENCE_RADIUS_METERS,
        });
      }
    }
  }

  const userVisits = await db
    .select()
    .from(visits)
    .where(and(eq(visits.employeeUserId, employeeUser.id), or(eq(visits.status, "SCHEDULED"), eq(visits.status, "IN_PROGRESS"))));
  for (const v of userVisits) {
    const cust = await db.select().from(customers).where(eq(customers.id, v.customerId)).limit(1);
    if (cust.length > 0 && cust[0].latitude && cust[0].longitude) {
      const lat = parseFloat(cust[0].latitude);
      const lng = parseFloat(cust[0].longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        allowedSites.push({
          name: cust[0].name || "Customer Visit",
          lat,
          lng,
          radius: DEFAULT_GEOFENCE_RADIUS_METERS,
        });
      }
    }
  }

  if (process.env.OFFICE_LAT && process.env.OFFICE_LNG) {
    const offLat = parseFloat(process.env.OFFICE_LAT);
    const offLng = parseFloat(process.env.OFFICE_LNG);
    const offRadius = Number(process.env.OFFICE_RADIUS_METERS) || DEFAULT_GEOFENCE_RADIUS_METERS;
    if (!isNaN(offLat) && !isNaN(offLng)) {
      allowedSites.push({
        name: "Headquarters",
        lat: offLat,
        lng: offLng,
        radius: offRadius,
      });
    }
  }

  // 3. Compute geofence status and distance
  let geofenceStatus: "inside" | "outside" | "unverified" = "unverified";
  let minDistanceMeters: number | undefined = undefined;

  if (input.checkInLat && input.checkInLng) {
    const empLat = parseFloat(input.checkInLat);
    const empLng = parseFloat(input.checkInLng);

    if (!isNaN(empLat) && !isNaN(empLng)) {
      if (allowedSites.length > 0) {
        let insideAny = false;
        let smallestDist = Infinity;

        for (const site of allowedSites) {
          const dist = haversineDistanceMeters(empLat, empLng, site.lat, site.lng);
          if (dist < smallestDist) {
            smallestDist = dist;
          }
          if (dist <= site.radius) {
            insideAny = true;
          }
        }

        minDistanceMeters = smallestDist;
        if (insideAny) {
          geofenceStatus = "inside";
        } else {
          geofenceStatus = "outside";
          status = "review"; // Flag for review when outside authorized geofence
        }
      } else {
        // Fallback when no sites configured
        geofenceStatus = "inside";
        minDistanceMeters = 0;
      }
    }
  }

  await db.insert(attendanceRecords).values({
    id,
    userId: employeeUser.id,
    checkInAt: effectiveCheckInAt,
    clientCheckInAt: validatedClientCheckIn,
    status,
    checkInPhotoUri: input.checkInPhotoUri,
    checkInLat: input.checkInLat,
    checkInLng: input.checkInLng,
    checkInAccuracy: input.checkInAccuracy,
    operationId: input.operationId || null,
    geofenceStatus,
    distanceMeters: minDistanceMeters,
  });

  const record = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, id)).limit(1);
  return record[0];
}

export async function recordAttendanceCheckOut(
  employeeUser: User,
  input: {
    checkOutPhotoUri?: string;
    clientCheckOutAt?: string;
    operationId?: string;
  }
): Promise<any> {
  if (employeeUser.role !== "employee") {
    throw new Error("Forbidden: Attendance check-out is restricted exclusively to field employees.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  // Idempotency: if operationId provided and matches completed record, return it
  if (input.operationId) {
    const existingOp = await db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.operationId, input.operationId))
      .limit(1);
    if (existingOp.length > 0 && existingOp[0].checkOutAt) {
      return existingOp[0];
    }
  }

  const validatedClientCheckOut = validateClientTimestamp(input.clientCheckOutAt);
  const now = new Date();
  const effectiveCheckOutAt = validatedClientCheckOut || now;

  // Find latest active attendance record for this user
  const activeRecords = await db
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.userId, employeeUser.id))
    .orderBy(desc(attendanceRecords.checkInAt))
    .limit(1);

  if (activeRecords.length === 0 || activeRecords[0].checkOutAt) {
    throw new Error("No active check-in session found to check out from.");
  }

  const targetRecord = activeRecords[0];

  await db
    .update(attendanceRecords)
    .set({
      checkOutAt: effectiveCheckOutAt,
      clientCheckOutAt: validatedClientCheckOut,
      checkOutPhotoUri: input.checkOutPhotoUri,
    })
    .where(eq(attendanceRecords.id, targetRecord.id));

  const updated = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, targetRecord.id)).limit(1);
  return updated[0];
}

/**
 * Review an attendance record flagged for review.
 * Allowed for Administrator or Manager (managers restricted to their assigned team).
 */
export async function reviewAttendanceRecord(
  actorUser: User,
  input: {
    recordId: string;
    decision: "approved" | "rejected";
    notes?: string;
  }
): Promise<any> {
  if (actorUser.role !== "admin" && actorUser.role !== "manager") {
    throw new Error("Forbidden: Only Administrators and Managers can review attendance records.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const records = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, input.recordId)).limit(1);
  if (records.length === 0) throw new Error("Attendance record not found.");
  const record = records[0];

  const targetUser = await getUserById(record.userId);
  if (!targetUser) throw new Error("Employee not found.");

  if (actorUser.role === "manager" && targetUser.managerId !== actorUser.id) {
    throw new Error("Forbidden: Managers can only review attendance records for employees in their own team.");
  }

  const now = new Date();
  const newStatus = input.decision === "approved" ? "verified" : "rejected";

  await db
    .update(attendanceRecords)
    .set({
      status: newStatus,
      reviewedByUserId: actorUser.id,
      reviewedAt: now,
      reviewNotes: input.notes || null,
    })
    .where(eq(attendanceRecords.id, input.recordId));

  const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(auditEvents).values({
    id: auditId,
    actorUserOpenId: actorUser.openId,
    subjectUserOpenId: targetUser.openId,
    action: "attendance.reviewed",
    detail: `${actorUser.name || actorUser.role} reviewed attendance record ${input.recordId} -> ${newStatus} (${input.notes || ""})`,
  });

  const updated = await db.select().from(attendanceRecords).where(eq(attendanceRecords.id, input.recordId)).limit(1);
  return updated[0];
}

/**
 * Returns team attendance records (with selfie URLs, status, GPS coordinates)
 * for managers (scoped to team) and administrators (all).
 */
export async function getTeamAttendance(
  actorUser: User,
  date?: string // YYYY-MM-DD
): Promise<any[]> {
  if (actorUser.role !== "admin" && actorUser.role !== "manager") {
    throw new Error("Forbidden: Only Administrators and Managers can view team attendance.");
  }

  const db = await getDb();
  if (!db) return [];

  let teamUserIds: number[] = [];
  if (actorUser.role === "admin") {
    const all = await db.select().from(users);
    teamUserIds = all.map((u) => u.id);
  } else {
    const teamMembers = await getUsersByManagerId(actorUser.id);
    teamUserIds = [actorUser.id, ...teamMembers.map((u) => u.id)];
  }

  if (teamUserIds.length === 0) return [];

  const allRecords = await db
    .select()
    .from(attendanceRecords)
    .orderBy(desc(attendanceRecords.checkInAt));

  const filtered = allRecords.filter((r) => teamUserIds.includes(r.userId));

  let finalRecords = filtered;
  if (date) {
    finalRecords = filtered.filter((r) => {
      const recordDate = formatKolkataDate(new Date(r.checkInAt));
      return recordDate === date;
    });
  }

  const allUsers = await getAllUsers();
  const userMap = new Map<number, User>();
  allUsers.forEach((u) => userMap.set(u.id, u));

  return finalRecords.map((r) => {
    const u = userMap.get(r.userId);
    return {
      ...r,
      employeeName: u?.name || `Employee #${r.userId}`,
      employeePhone: u?.phoneE164,
      employeeRole: u?.role,
    };
  });
}

export async function getAttendanceRecords(
  actorUser: User,
  targetUserId?: number,
  month?: number,
  year?: number
): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];

  const targetId = targetUserId ?? actorUser.id;
  const targetUser = await getUserById(targetId);
  if (!targetUser) throw new Error("Target user not found.");

  // RBAC Authorization check
  if (actorUser.role === "admin") {
    // Admin can view all
  } else if (actorUser.role === "manager") {
    if (targetUser.managerId !== actorUser.id && targetUser.id !== actorUser.id) {
      throw new Error("Forbidden: Managers can only view attendance for employees in their own team.");
    }
  } else {
    if (actorUser.id !== targetId) {
      throw new Error("Forbidden: Employees can only view their own attendance records.");
    }
  }

  let query = db.select().from(attendanceRecords).where(eq(attendanceRecords.userId, targetId));
  return await query.orderBy(desc(attendanceRecords.checkInAt));
}

/**
 * Customers Management
 */
/**
 * Customers Management
 */
export async function createCustomer(
  actorUser: User,
  input: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    latitude?: string;
    longitude?: string;
    notes?: string;
    operationId?: string;
  }
): Promise<DbCustomer> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  if (input.operationId) {
    const existingOp = await db.select().from(customers).where(eq(customers.operationId, input.operationId)).limit(1);
    if (existingOp.length > 0) return existingOp[0];
  }

  const customerId = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(customers).values({
    id: customerId,
    name: input.name.trim(),
    phone: input.phone?.trim(),
    email: input.email?.trim(),
    address: input.address?.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    notes: input.notes?.trim(),
    createdByUserId: actorUser.id,
    status: "active",
    operationId: input.operationId || null,
  });

  const created = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  return created[0];
}

export async function updateCustomer(
  actorUser: User,
  customerId: string,
  input: Partial<{
    name: string;
    phone: string;
    email: string;
    address: string;
    latitude: string;
    longitude: string;
    notes: string;
    status: "active" | "archived";
  }>
): Promise<DbCustomer> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const existing = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (existing.length === 0) throw new Error("Customer not found.");

  // Ownership check: creator, manager, or admin
  if (actorUser.role === "employee" && existing[0].createdByUserId !== actorUser.id) {
    throw new Error("Forbidden: You can only update customers that you created.");
  }

  await db.update(customers).set(input).where(eq(customers.id, customerId));
  const updated = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  return updated[0];
}

export async function listCustomers(actorUser: User): Promise<DbCustomer[]> {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(customers)
    .where(eq(customers.status, "active"))
    .orderBy(desc(customers.createdAt));
}

/**
 * Customer Visits Management
 */
export async function createVisit(
  actorUser: User,
  input: {
    customerId: string;
    employeeUserId?: number;
    scheduledFor: Date;
    notes?: string;
    operationId?: string;
  }
): Promise<DbVisit> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  if (input.operationId) {
    const existingOp = await db.select().from(visits).where(eq(visits.operationId, input.operationId)).limit(1);
    if (existingOp.length > 0) return existingOp[0];
  }

  const assignedEmployeeId = input.employeeUserId || actorUser.id;

  // RBAC validation:
  if (actorUser.role === "employee" && assignedEmployeeId !== actorUser.id) {
    throw new Error("Forbidden: Field employees can only schedule visits for themselves.");
  }
  if (actorUser.role === "manager") {
    const targetUser = await getUserById(assignedEmployeeId);
    if (targetUser?.managerId !== actorUser.id && assignedEmployeeId !== actorUser.id) {
      throw new Error("Forbidden: Managers can only schedule visits for members of their team.");
    }
  }

  const visitId = `visit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(visits).values({
    id: visitId,
    customerId: input.customerId,
    employeeUserId: assignedEmployeeId,
    scheduledFor: input.scheduledFor,
    status: "SCHEDULED",
    notes: input.notes,
    operationId: input.operationId || null,
  });

  const created = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  return created[0];
}

export async function checkInVisit(
  actorUser: User,
  visitId: string,
  input: {
    latitude?: string;
    longitude?: string;
  }
): Promise<DbVisit> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const existing = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  if (existing.length === 0) throw new Error("Visit not found.");

  const visit = existing[0];
  if (actorUser.role === "employee" && visit.employeeUserId !== actorUser.id) {
    throw new Error("Forbidden: You can only check in to your own assigned visits.");
  }

  const now = new Date();
  await db
    .update(visits)
    .set({
      status: "IN_PROGRESS",
      checkInAt: now,
      checkInLat: input.latitude,
      checkInLng: input.longitude,
    })
    .where(eq(visits.id, visitId));

  const updated = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  return updated[0];
}

export async function completeVisit(
  actorUser: User,
  visitId: string,
  input: {
    latitude?: string;
    longitude?: string;
    meetingOutcome?: string;
    notes?: string;
    followUpDate?: string;
  }
): Promise<DbVisit> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const existing = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  if (existing.length === 0) throw new Error("Visit not found.");

  const visit = existing[0];
  if (actorUser.role === "employee" && visit.employeeUserId !== actorUser.id) {
    throw new Error("Forbidden: You can only complete your own assigned visits.");
  }

  const now = new Date();
  await db
    .update(visits)
    .set({
      status: "COMPLETED",
      checkOutAt: now,
      checkOutLat: input.latitude,
      checkOutLng: input.longitude,
      meetingOutcome: input.meetingOutcome,
      notes: input.notes,
      followUpDate: input.followUpDate,
    })
    .where(eq(visits.id, visitId));

  const updated = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  return updated[0];
}

export async function updateVisitNotes(
  actorUser: User,
  visitId: string,
  input: {
    meetingOutcome?: string;
    notes?: string;
    followUpDate?: string;
  }
): Promise<DbVisit> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const existing = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  if (existing.length === 0) throw new Error("Visit not found.");

  const visit = existing[0];
  if (actorUser.role === "employee" && visit.employeeUserId !== actorUser.id) {
    throw new Error("Forbidden: You can only update notes for your own assigned visits.");
  }

  const updates: Partial<InsertDbVisit> = {};
  if (input.meetingOutcome !== undefined) updates.meetingOutcome = input.meetingOutcome;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.followUpDate !== undefined) updates.followUpDate = input.followUpDate;

  if (Object.keys(updates).length > 0) {
    await db.update(visits).set(updates).where(eq(visits.id, visitId));
  }

  const updated = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  return updated[0];
}

export async function addVisitEvidence(
  actorUser: User,
  visitId: string,
  input: {
    evidenceUrl: string;
    latitude?: string;
    longitude?: string;
  }
): Promise<DbVisitEvidence> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const existingVisit = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  if (existingVisit.length === 0) throw new Error("Visit not found.");
  const visit = existingVisit[0];

  // Ownership check: owner, their manager, or admin
  if (actorUser.role === "employee" && visit.employeeUserId !== actorUser.id) {
    throw new Error("Forbidden: Employees can only add evidence to their own visits.");
  } else if (actorUser.role === "manager") {
    const owner = await getUserById(visit.employeeUserId);
    if (owner?.managerId !== actorUser.id && visit.employeeUserId !== actorUser.id) {
      throw new Error("Forbidden: Managers can only add evidence to visits for their assigned team.");
    }
  }

  const evidenceId = `evid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(visitEvidence).values({
    id: evidenceId,
    visitId,
    evidenceUrl: input.evidenceUrl,
    latitude: input.latitude,
    longitude: input.longitude,
  });

  const created = await db.select().from(visitEvidence).where(eq(visitEvidence.id, evidenceId)).limit(1);
  return created[0];
}

export async function listVisits(
  actorUser: User,
  options?: {
    date?: string;
    customerId?: string;
  }
): Promise<Array<DbVisit & { customerName?: string; evidenceCount?: number }>> {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(visits);

  let rawVisits: DbVisit[];
  if (actorUser.role === "admin") {
    rawVisits = await query.orderBy(desc(visits.scheduledFor));
  } else if (actorUser.role === "manager") {
    const team = await getUsersByManagerId(actorUser.id);
    const teamIds = [actorUser.id, ...team.map((t) => t.id)];
    rawVisits = (await query.orderBy(desc(visits.scheduledFor))).filter((v) => teamIds.includes(v.employeeUserId));
  } else {
    rawVisits = await db
      .select()
      .from(visits)
      .where(eq(visits.employeeUserId, actorUser.id))
      .orderBy(desc(visits.scheduledFor));
  }

  // Enrich with customer name
  const allCustomers = await db.select().from(customers);
  const custMap = new Map<string, string>();
  allCustomers.forEach((c) => custMap.set(c.id, c.name));

  return rawVisits.map((v) => ({
    ...v,
    customerName: custMap.get(v.customerId) || "Customer",
  }));
}

export async function getVisitDetail(
  actorUser: User,
  visitId: string
): Promise<{ visit: DbVisit; customer?: DbCustomer; evidence: DbVisitEvidence[] } | null> {
  const db = await getDb();
  if (!db) return null;

  const existing = await db.select().from(visits).where(eq(visits.id, visitId)).limit(1);
  if (existing.length === 0) return null;

  const visit = existing[0];

  // Ownership check: owner, their manager, or admin
  if (actorUser.role === "employee" && visit.employeeUserId !== actorUser.id) {
    throw new Error("Forbidden: Employees can only view their own visits.");
  } else if (actorUser.role === "manager") {
    const owner = await getUserById(visit.employeeUserId);
    if (owner?.managerId !== actorUser.id && visit.employeeUserId !== actorUser.id) {
      throw new Error("Forbidden: Managers can only view visits for their assigned team.");
    }
  }

  const customerList = await db.select().from(customers).where(eq(customers.id, visit.customerId)).limit(1);
  const evidenceList = await db.select().from(visitEvidence).where(eq(visitEvidence.visitId, visitId));

  return {
    visit,
    customer: customerList[0],
    evidence: evidenceList,
  };
}

/**
 * Chat Messaging System
 */
export async function getOrCreateDirectChannel(
  actorUser: User,
  targetUserId: number
): Promise<DbChatChannel> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const targetUser = await getUserById(targetUserId);
  if (!targetUser) throw new Error("Target user not found.");

  // Ownership check: only between employee and their assigned manager or admin
  if (actorUser.role === "employee") {
    if (targetUser.role !== "admin" && actorUser.managerId !== targetUserId) {
      throw new Error("Forbidden: Employees can only chat with their assigned manager or an administrator.");
    }
  } else if (actorUser.role === "manager") {
    if (targetUser.role !== "admin" && targetUser.managerId !== actorUser.id) {
      throw new Error("Forbidden: Managers can only chat with their assigned team members or administrators.");
    }
  }

  // Check if channel exists in either order
  const existing = await db
    .select()
    .from(chatChannels)
    .where(
      or(
        and(eq(chatChannels.managerUserId, actorUser.id), eq(chatChannels.employeeUserId, targetUserId)),
        and(eq(chatChannels.managerUserId, targetUserId), eq(chatChannels.employeeUserId, actorUser.id))
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const channelId = `chan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(chatChannels).values({
    id: channelId,
    type: "direct",
    managerUserId: actorUser.role === "manager" || actorUser.role === "admin" ? actorUser.id : targetUserId,
    employeeUserId: actorUser.role === "employee" ? actorUser.id : targetUserId,
  });

  const created = await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1);
  return created[0];
}

export async function sendChatMessage(
  actorUser: User,
  channelId: string,
  message: string,
  operationId?: string
): Promise<DbChatMessage> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  if (operationId) {
    const existingOp = await db.select().from(chatMessages).where(eq(chatMessages.operationId, operationId)).limit(1);
    if (existingOp.length > 0) return existingOp[0];
  }

  const channels = await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1);
  if (channels.length === 0) throw new Error("Chat channel not found.");
  const chan = channels[0];

  // Channel membership check
  if (actorUser.role !== "admin" && chan.managerUserId !== actorUser.id && chan.employeeUserId !== actorUser.id) {
    throw new Error("Forbidden: You are not a member of this chat channel.");
  }

  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(chatMessages).values({
    id: msgId,
    channelId,
    senderUserId: actorUser.id,
    message: message.trim(),
    status: "sent",
    operationId: operationId || null,
  });

  const created = await db.select().from(chatMessages).where(eq(chatMessages.id, msgId)).limit(1);
  return created[0];
}

export async function getChannelMessages(
  actorUser: User,
  channelId: string,
  limitCount = 50
): Promise<DbChatMessage[]> {
  const db = await getDb();
  if (!db) return [];

  const channels = await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1);
  if (channels.length === 0) return [];
  const chan = channels[0];

  // Channel membership check
  if (actorUser.role !== "admin" && chan.managerUserId !== actorUser.id && chan.employeeUserId !== actorUser.id) {
    throw new Error("Forbidden: You are not a member of this chat channel.");
  }

  return await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.channelId, channelId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limitCount);
}

/**
 * Field Expenses System
 */
export async function createExpense(
  actorUser: User,
  input: {
    amount: number;
    category: string;
    description?: string;
    receiptUrl?: string;
    expenseDate: string;
    operationId?: string;
  }
): Promise<DbExpense> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  if (input.operationId) {
    const existingOp = await db.select().from(expenses).where(eq(expenses.operationId, input.operationId)).limit(1);
    if (existingOp.length > 0) return existingOp[0];
  }

  const expenseId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(expenses).values({
    id: expenseId,
    employeeUserId: actorUser.id,
    amount: input.amount,
    category: input.category,
    description: input.description,
    receiptUrl: input.receiptUrl,
    expenseDate: input.expenseDate,
    status: "SUBMITTED",
    operationId: input.operationId || null,
  });

  const created = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  return created[0];
}

export async function listExpenses(
  actorUser: User
): Promise<Array<DbExpense & { employeeName?: string }>> {
  const db = await getDb();
  if (!db) return [];

  let rawList: DbExpense[];
  if (actorUser.role === "admin") {
    rawList = await db.select().from(expenses).orderBy(desc(expenses.createdAt));
  } else if (actorUser.role === "manager") {
    const team = await getUsersByManagerId(actorUser.id);
    const teamIds = [actorUser.id, ...team.map((t) => t.id)];
    const all = await db.select().from(expenses).orderBy(desc(expenses.createdAt));
    rawList = all.filter((e) => teamIds.includes(e.employeeUserId));
  } else {
    rawList = await db
      .select()
      .from(expenses)
      .where(eq(expenses.employeeUserId, actorUser.id))
      .orderBy(desc(expenses.createdAt));
  }

  const allUsers = await getAllUsers();
  const userMap = new Map<number, string>();
  allUsers.forEach((u) => userMap.set(u.id, u.name || `Employee #${u.id}`));

  return rawList.map((e) => ({
    ...e,
    employeeName: userMap.get(e.employeeUserId) || "Employee",
  }));
}

export async function reviewExpense(
  actorUser: User,
  expenseId: string,
  decision: "APPROVED" | "REJECTED"
): Promise<DbExpense> {
  if (actorUser.role !== "admin" && actorUser.role !== "manager") {
    throw new Error("Forbidden: Only Administrators and Managers can approve or reject expenses.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const expList = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (expList.length === 0) throw new Error("Expense not found.");
  const exp = expList[0];

  // Never self-approval
  if (exp.employeeUserId === actorUser.id) {
    throw new Error("Forbidden: Self-approval of expenses is prohibited.");
  }

  // Managers can only review for their team
  if (actorUser.role === "manager") {
    const owner = await getUserById(exp.employeeUserId);
    if (owner?.managerId !== actorUser.id) {
      throw new Error("Forbidden: Managers can only review expenses for their own team.");
    }
  }

  await db
    .update(expenses)
    .set({
      status: decision,
      approvedByUserId: actorUser.id,
    })
    .where(eq(expenses.id, expenseId));

  const updated = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  return updated[0];
}

/**
 * Notifications & Device Tokens
 */
export async function registerDeviceSession(
  userId: number,
  input: {
    expoPushToken?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
  }
): Promise<DbDeviceSession> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const sessionId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(deviceSessions).values({
    id: sessionId,
    userId,
    expoPushToken: input.expoPushToken,
    deviceModel: input.deviceModel,
    osVersion: input.osVersion,
    appVersion: input.appVersion,
  });

  const created = await db.select().from(deviceSessions).where(eq(deviceSessions.id, sessionId)).limit(1);
  return created[0];
}

export async function createNotification(
  recipientUserId: number,
  input: {
    title: string;
    body: string;
    type?: string;
    dataJson?: string;
  }
): Promise<DbNotification> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const notifId = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(notifications).values({
    id: notifId,
    recipientUserId,
    title: input.title,
    body: input.body,
    type: input.type || "general",
    dataJson: input.dataJson,
  });

  const created = await db.select().from(notifications).where(eq(notifications.id, notifId)).limit(1);
  return created[0];
}

export async function getUserNotifications(userId: number): Promise<DbNotification[]> {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientUserId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
}

/**
 * Get audit logs for sensitive operations.
 */
export async function getAuditLogs(actorUser: User): Promise<any[]> {
  if (actorUser.role !== "admin") {
    throw new Error("Forbidden: Only Administrators can access audit logs.");
  }

  const db = await getDb();
  if (!db) return [];

  return await db.select().from(auditEvents).orderBy(desc(auditEvents.occurredAt)).limit(100);
}


