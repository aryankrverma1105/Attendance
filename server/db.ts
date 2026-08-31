import dotenv from "dotenv";
dotenv.config();

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  accountActionOutbox,
  accountInvitations,
  attendanceRecords,
  auditEvents,
  employeeWages,
  EmployeeWage,
  gpsPoints,
  DbGpsPoint,
  tasks,
  DbTask,
  InsertUser,
  User,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
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

export async function autoActivateUser(firebaseUid: string, phoneE164: string, name: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot auto-activate user: database not available");
    return undefined;
  }

  return await db.transaction(async (tx) => {
    const openId = `firebase_${firebaseUid}`;
    const signedInAt = new Date();

    const existing = await tx.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
    if (existing.length > 0) {
      return existing[0];
    }

    const existingByPhone = await tx.select().from(users).where(eq(users.phoneE164, phoneE164)).limit(1);
    if (existingByPhone.length > 0) {
      await tx
        .update(users)
        .set({
          firebaseUid,
          lastSignedIn: signedInAt,
        })
        .where(eq(users.id, existingByPhone[0].id));
      const updated = await tx.select().from(users).where(eq(users.id, existingByPhone[0].id)).limit(1);
      return updated[0];
    }

    const allUsers = await tx.select().from(users).limit(1);
    const role = allUsers.length === 0 ? "admin" : "employee";

    const [insertResult] = await tx.insert(users).values({
      openId,
      firebaseUid,
      phoneE164,
      name,
      role,
      accountStatus: "active",
      lastSignedIn: signedInAt,
    });

    const userId = insertResult.insertId;

    const auditId = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await tx.insert(auditEvents).values({
      id: auditId,
      actorUserOpenId: openId,
      subjectUserOpenId: openId,
      action: "account.auto_activated",
      detail: `Auto-activated first-time or dev account for phone ${phoneE164} as role ${role}`,
    });

    const activeUser = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    return activeUser[0];
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
    console.warn("[Database] Cannot update wage: database not available");
    return { success: true, updatedWage: newDailyWage };
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
 * Calculates server-side verified worked days (count of unique calendar dates with verified check-in)
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

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);

  // Fetch verified attendance records within the date range
  const records = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.userId, userId),
        eq(attendanceRecords.status, "verified"),
        gte(attendanceRecords.checkInAt, startOfMonth),
        lte(attendanceRecords.checkInAt, endOfMonth)
      )
    );

  // Count unique calendar dates (YYYY-MM-DD)
  const uniqueDatesSet = new Set<string>();
  records.forEach((r) => {
    const dateStr = r.checkInAt.toISOString().slice(0, 10);
    uniqueDatesSet.add(dateStr);
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
      const workedDate = new Date(dateStr);
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
  }
): Promise<DbTask> {
  if (actorUser.role !== "admin" && actorUser.role !== "manager") {
    throw new Error("Forbidden: Only Administrators and Managers can assign tasks.");
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

  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable.");
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
  }
): Promise<DbGpsPoint> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");

  const id = `gps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(gpsPoints).values({
    id,
    userId,
    recordedDate: point.recordedDate,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: point.accuracy,
    address: point.address,
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

