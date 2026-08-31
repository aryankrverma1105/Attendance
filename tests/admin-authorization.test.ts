import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { hasPermission, canPerformAction } from "../lib/field-access";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockContext(user: AuthenticatedUser | null): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      hostname: "localhost",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
}

describe("Admin Authorization & Operational Constraint Security", () => {
  const adminUser: AuthenticatedUser = {
    id: 1,
    openId: "admin_openid_1",
    firebaseUid: "firebase_admin_1",
    phoneE164: "+919999900001",
    name: "Admin Executive",
    email: "admin@sologix.energy",
    loginMethod: "firebase",
    role: "admin",
    accountStatus: "active",
    dailyWage: 0,
    managerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  it("ALLOWS Admin to read organization reports", async () => {
    const ctx = createMockContext(adminUser);
    const caller = appRouter.createCaller(ctx);

    const report = await caller.reports.getOrganizationReport();
    expect(report).toBeDefined();
    expect(report.totalUsers).toBeGreaterThanOrEqual(0);
  }, 15000);

  it("ALLOWS Admin to read audit logs", async () => {
    const ctx = createMockContext(adminUser);
    const caller = appRouter.createCaller(ctx);

    const logs = await caller.audit.getLogs();
    expect(Array.isArray(logs)).toBe(true);
  }, 15000);

  it("DENIES Admin from Employee Check-In (Operational Constraint)", async () => {
    const ctx = createMockContext(adminUser);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.attendance.checkIn({
        checkInLat: "23.3441",
        checkInLng: "85.3096",
      })
    ).rejects.toThrow(/Forbidden/);
  });

  it("DENIES Admin from Employee Check-Out (Operational Constraint)", async () => {
    const ctx = createMockContext(adminUser);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.attendance.checkOut({})
    ).rejects.toThrow(/Forbidden/);
  });

  it("DENIES Admin from Recording GPS Tracking Points (Operational Constraint)", async () => {
    const ctx = createMockContext(adminUser);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.tracking.recordPoint({
        recordedDate: "2026-08-31",
        latitude: "23.3441",
        longitude: "85.3096",
      })
    ).rejects.toThrow(/Forbidden/);
  });

  it("Verifies static permission matrix for Admin", () => {
    expect(hasPermission("admin", "users.read.all")).toBe(true);
    expect(hasPermission("admin", "users.create")).toBe(true);
    expect(hasPermission("admin", "users.setWage")).toBe(true);
    expect(hasPermission("admin", "users.suspend")).toBe(true);
    expect(hasPermission("admin", "users.deactivate")).toBe(true);
    expect(hasPermission("admin", "reports.read.all")).toBe(true);
    expect(hasPermission("admin", "audit.read")).toBe(true);

    // Static denial of employee operational permissions
    expect(hasPermission("admin", "attendance.create.self")).toBe(false);
    expect(hasPermission("admin", "attendance.checkout.self")).toBe(false);
    expect(hasPermission("admin", "tracking.create.self")).toBe(false);
  });
});
