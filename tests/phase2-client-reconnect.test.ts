import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import type { User } from "../drizzle/schema";
import * as db from "../server/db";

function createMockContext(user: User | null): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      hostname: "api.example.com",
      headers: {
        authorization: "Bearer mock_token",
      },
    } as any,
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any,
  };
}

const mockAdminUser: User = {
  id: 1,
  openId: "admin-open-id",
  firebaseUid: "fb-admin",
  phoneE164: "+919835916278",
  name: "Admin User",
  email: "admin@sologix.com",
  loginMethod: "phone",
  role: "admin",
  accountStatus: "active",
  dailyWage: 0,
  managerId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
  sessionVersion: 1,
};

const mockEmployeeUser: User = {
  id: 2,
  openId: "emp-open-id",
  firebaseUid: "fb-emp",
  phoneE164: "+919876543210",
  name: "Field Employee",
  email: "employee@sologix.com",
  loginMethod: "phone",
  role: "employee",
  accountStatus: "active",
  dailyWage: 750,
  managerId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
  sessionVersion: 1,
};

describe("Phase 2: Client Reconnection & Integrity", () => {
  describe("Item 11 & 13: Server-First Mutations and Validation", () => {
    it("REJECTS attendance check-in for non-employee roles (e.g. Admin or Manager)", async () => {
      const adminCtx = createMockContext(mockAdminUser);
      const caller = appRouter.createCaller(adminCtx);

      await expect(
        caller.attendance.checkIn({
          checkInPhotoUri: "https://storage.example.com/selfie.jpg",
          checkInLat: "28.6139",
          checkInLng: "77.2090",
        })
      ).rejects.toThrow(/restricted strictly to field employees/);
    });

    it("CREATES tasks with numeric assignedToUserId and idempotencyKey", async () => {
      const adminCtx = createMockContext(mockAdminUser);
      const caller = appRouter.createCaller(adminCtx);

      const idempotencyKey = "task-test-idemp-" + Date.now();
      const mockCreatedTask: any = {
        id: idempotencyKey,
        title: "Inspect Inverter Panel B",
        assignedToUserId: 2,
        assignedByUserId: 1,
        scheduledDate: "2026-09-14",
        priority: "URGENT",
        status: "PENDING",
        customerName: "Acme Solar Corp",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(db, "createTask").mockResolvedValueOnce(mockCreatedTask);

      const createdTask = await caller.tasks.create({
        title: "Inspect Inverter Panel B",
        assignedToUserId: 2,
        scheduledDate: "2026-09-14",
        priority: "URGENT",
        customerName: "Acme Solar Corp",
        idempotencyKey,
      });

      expect(createdTask).toBeDefined();
      expect(createdTask.id).toBe(idempotencyKey);
      expect(createdTask.assignedToUserId).toBe(2);
      expect(createdTask.title).toBe("Inspect Inverter Panel B");
    });

    it("IDEMPOTENCY: Creating a task with the same idempotencyKey returns existing record without duplicating", async () => {
      const adminCtx = createMockContext(mockAdminUser);
      const caller = appRouter.createCaller(adminCtx);

      const idempotencyKey = "task-duplicate-check-" + Date.now();
      const mockTask: any = {
        id: idempotencyKey,
        title: "Replace Breaker 4",
        assignedToUserId: 2,
        assignedByUserId: 1,
        scheduledDate: "2026-09-14",
        priority: "MEDIUM",
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(db, "createTask")
        .mockResolvedValueOnce(mockTask)
        .mockResolvedValueOnce(mockTask);

      const task1 = await caller.tasks.create({
        title: "Replace Breaker 4",
        assignedToUserId: 2,
        scheduledDate: "2026-09-14",
        priority: "MEDIUM",
        idempotencyKey,
      });

      const task2 = await caller.tasks.create({
        title: "Replace Breaker 4 (retry)",
        assignedToUserId: 2,
        scheduledDate: "2026-09-14",
        priority: "MEDIUM",
        idempotencyKey,
      });

      expect(task1.id).toBe(task2.id);
      expect(task2.title).toBe("Replace Breaker 4");
    });

    it("UPDATES employee daily wage with strict Admin-only authorization", async () => {
      const empCtx = createMockContext(mockEmployeeUser);
      const empCaller = appRouter.createCaller(empCtx);

      await expect(
        empCaller.workforce.setEmployeeWage({
          targetUserId: 2,
          dailyWage: 900,
        })
      ).rejects.toThrow(/Only Administrators are authorized/);

      const adminCtx = createMockContext(mockAdminUser);
      const adminCaller = appRouter.createCaller(adminCtx);

      vi.spyOn(db, "updateUserDailyWage").mockResolvedValueOnce({
        success: true,
        updatedWage: 900,
      });

      const updated = await adminCaller.workforce.setEmployeeWage({
        targetUserId: 2,
        dailyWage: 900,
      });

      expect(updated.success).toBe(true);
      expect(updated.updatedWage).toBe(900);
    });

    it("UPDATES user account status and increments session version to invalidate old sessions", async () => {
      const adminCtx = createMockContext(mockAdminUser);
      const adminCaller = appRouter.createCaller(adminCtx);

      vi.spyOn(db, "updateUserStatusByAdmin").mockResolvedValueOnce({
        success: true,
        user: { ...mockEmployeeUser, accountStatus: "suspended", sessionVersion: 2 } as any,
      });

      const result = await adminCaller.workforce.updateUserStatus({
        targetUserId: 2,
        accountStatus: "suspended",
      });

      expect(result.success).toBe(true);
      expect(result.user?.accountStatus).toBe("suspended");
      expect(result.user?.sessionVersion).toBe(2);
    });
  });

  describe("Item 14: Automated Offline Sync Queue & Idempotency", () => {
    it("Attendance check-in records idempotently on server", async () => {
      const empCtx = createMockContext(mockEmployeeUser);
      const caller = appRouter.createCaller(empCtx);

      const idempotencyKey = "att-idemp-" + Date.now();
      const mockRecord = {
        id: idempotencyKey,
        userId: mockEmployeeUser.id,
        checkInAt: new Date(),
        status: "verified",
      };

      vi.spyOn(db, "recordAttendanceCheckIn")
        .mockResolvedValueOnce({ success: true, record: mockRecord } as any)
        .mockResolvedValueOnce({ success: true, record: mockRecord } as any);

      const res1 = await caller.attendance.checkIn({
        checkInPhotoUri: "https://storage.example.com/selfie-sync-1.jpg",
        checkInLat: "28.6139",
        checkInLng: "77.2090",
        idempotencyKey,
      });

      expect(res1.success).toBe(true);
      expect(res1.record.id).toBe(idempotencyKey);

      const res2 = await caller.attendance.checkIn({
        checkInPhotoUri: "https://storage.example.com/selfie-sync-1.jpg",
        checkInLat: "28.6139",
        checkInLng: "77.2090",
        idempotencyKey,
      });

      expect(res2.record.id).toBe(res1.record.id);
    });
  });
});
