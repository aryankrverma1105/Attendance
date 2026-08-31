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

describe("Employee Authorization & Self-Scoping Defense Security", () => {
  const employeeA: AuthenticatedUser = {
    id: 101,
    openId: "emp_101_openid",
    firebaseUid: "firebase_emp_101",
    phoneE164: "+919999900101",
    name: "Employee Alex",
    email: "alex@sologix.energy",
    loginMethod: "firebase",
    role: "employee",
    accountStatus: "active",
    dailyWage: 750,
    managerId: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  it("DENIES Employee from User Directory listing (listUsers)", async () => {
    const ctx = createMockContext(employeeA);
    const caller = appRouter.createCaller(ctx);

    await expect(caller.workforce.listUsers()).rejects.toThrow(/Forbidden/);
  });

  it("DENIES Employee from Task Dispatch / Assignment (tasks.create)", async () => {
    const ctx = createMockContext(employeeA);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.tasks.create({
        title: "Malicious Task Assignment",
        assignedToUserId: 102,
        scheduledDate: "2026-08-31",
        priority: "URGENT",
      })
    ).rejects.toThrow(/Forbidden/);
  });

  it("DENIES Employee from changing wages (setEmployeeWage)", async () => {
    const ctx = createMockContext(employeeA);
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.workforce.setEmployeeWage({
        targetUserId: 101,
        dailyWage: 99999,
      })
    ).rejects.toThrow(/Forbidden/);
  });

  it("DENIES Employee from accessing Organization / Team Reports", async () => {
    const ctx = createMockContext(employeeA);
    const caller = appRouter.createCaller(ctx);

    await expect(caller.reports.getOrganizationReport()).rejects.toThrow(/Forbidden/);
    await expect(caller.reports.getTeamReport()).rejects.toThrow(/Forbidden/);
  });

  it("DENIES Employee A from accessing Employee B's dashboard, routes, tasks (Cross-User IDOR Defense)", async () => {
    const ctx = createMockContext(employeeA);
    const caller = appRouter.createCaller(ctx);

    // Cross-user dashboard request attempt
    await expect(
      caller.workforce.getEmployeeDashboard({ targetUserId: 102 })
    ).rejects.toThrow(/Forbidden/);

    // Cross-user earnings request attempt
    await expect(
      caller.workforce.getEarningsHistory({ targetUserId: 102 })
    ).rejects.toThrow(/Forbidden/);

    // Cross-user route playback permission test
    const canViewOtherRoute = canPerformAction(
      { role: "employee", id: "101" },
      "routes.read.self",
      { targetUserId: "102" }
    );
    expect(canViewOtherRoute).toBe(false);

    // Cross-user task update permission test
    const canUpdateOtherTask = canPerformAction(
      { role: "employee", id: "101" },
      "tasks.update.self",
      { assignedToUserId: "102" }
    );
    expect(canUpdateOtherTask).toBe(false);
  });

  it("ALLOWS Employee A to access and operate on own data and assigned tasks", () => {
    const canViewOwnRoute = canPerformAction(
      { role: "employee", id: "101" },
      "routes.read.self",
      { targetUserId: "101" }
    );
    expect(canViewOwnRoute).toBe(true);

    const canUpdateOwnTask = canPerformAction(
      { role: "employee", id: "101" },
      "tasks.update.self",
      { assignedToUserId: "101" }
    );
    expect(canUpdateOwnTask).toBe(true);

    expect(hasPermission("employee", "attendance.create.self")).toBe(true);
    expect(hasPermission("employee", "attendance.checkout.self")).toBe(true);
    expect(hasPermission("employee", "tracking.create.self")).toBe(true);
  });
});
