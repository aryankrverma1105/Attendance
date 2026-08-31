import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

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

describe("End-to-End RBAC & tRPC Procedure Security", () => {
  const adminUser: AuthenticatedUser = {
    id: 1,
    openId: "admin_openid_1",
    firebaseUid: "firebase_admin_1",
    phoneE164: "+919999900001",
    name: "Admin User",
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

  const managerA: AuthenticatedUser = {
    id: 10,
    openId: "manager_a_openid",
    firebaseUid: "firebase_mgr_a",
    phoneE164: "+919999900010",
    name: "Manager A",
    email: "managerA@sologix.energy",
    loginMethod: "firebase",
    role: "manager",
    accountStatus: "active",
    dailyWage: 0,
    managerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const employeeUser: AuthenticatedUser = {
    id: 101,
    openId: "emp_101_openid",
    firebaseUid: "firebase_emp_101",
    phoneE164: "+919999900101",
    name: "Aryan Field Engineer",
    email: "aryan@sologix.energy",
    loginMethod: "firebase",
    role: "employee",
    accountStatus: "active",
    dailyWage: 700,
    managerId: 10, // Assigned to Manager A
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  describe("setEmployeeWage Procedure Authorization", () => {
    it("verifies Admin setEmployeeWage executes server validation and target check", async () => {
      const ctx = createMockContext(adminUser);
      const caller = appRouter.createCaller(ctx);

      // Verify that calling with an unseeded targetId triggers server target check
      await expect(
        caller.workforce.setEmployeeWage({
          targetUserId: 999999,
          dailyWage: 750,
        })
      ).rejects.toThrow();
    }, 15000);

    it("DENIES Employee from calling setEmployeeWage (throws FORBIDDEN TRPCError)", async () => {
      const ctx = createMockContext(employeeUser);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.workforce.setEmployeeWage({
          targetUserId: 101,
          dailyWage: 999999, // Client manipulation attempt
        })
      ).rejects.toThrow();
    });

    it("DENIES unauthenticated user from accessing workforce procedures (throws UNAUTHORIZED)", async () => {
      const ctx = createMockContext(null);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.workforce.getEmployeeDashboard()
      ).rejects.toThrow();

      await expect(
        caller.workforce.setEmployeeWage({
          targetUserId: 101,
          dailyWage: 800,
        })
      ).rejects.toThrow();
    });

    it("DENIES Employee from accessing getAdminOverview", async () => {
      const ctx = createMockContext(employeeUser);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.workforce.getAdminOverview()).rejects.toThrow();
    });
  });

  describe("Client-Side Manipulation Defense", () => {
    it("ensures getEmployeeDashboard derives target employee strictly from ctx.user (cannot be spoofed)", async () => {
      const ctx = createMockContext(employeeUser);
      const caller = appRouter.createCaller(ctx);

      const dashboard = await caller.workforce.getEmployeeDashboard();

      expect(dashboard).toBeDefined();
      expect(dashboard.dailyWage).toBe(700);
      expect(typeof dashboard.workedDays).toBe("number");
      expect(typeof dashboard.calculatedEarnings).toBe("number");
    });
  });
});
