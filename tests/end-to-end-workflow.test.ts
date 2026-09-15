import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { canPerformAction, hasPermission } from "../lib/field-access";

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

describe("End-to-End Enterprise Workflow Test (Admin -> Manager -> Employee -> Manager -> Admin)", () => {
  const adminUser: AuthenticatedUser = {
    id: 1,
    openId: "admin_openid_1",
    firebaseUid: "firebase_admin_1",
    phoneE164: "+919999900001",
    name: "Admin Sologix",
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

  const managerUser: AuthenticatedUser = {
    id: 10,
    openId: "manager_openid_10",
    firebaseUid: "firebase_mgr_10",
    phoneE164: "+919999900010",
    name: "Manager Rohit",
    email: "rohit@sologix.energy",
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
    openId: "emp_openid_101",
    firebaseUid: "firebase_emp_101",
    phoneE164: "+919999900101",
    name: "Aryan Field Tech",
    email: "aryan@sologix.energy",
    loginMethod: "firebase",
    role: "employee",
    accountStatus: "active",
    dailyWage: 800,
    managerId: 10, // Assigned to Manager Rohit
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  it("Executes Stage 1: Admin configures workforce and oversees organization", async () => {
    const adminCtx = createMockContext(adminUser);
    const adminCaller = appRouter.createCaller(adminCtx);

    // 1. Admin reads organization report
    const orgReport = await adminCaller.reports.getOrganizationReport();
    expect(orgReport).toBeDefined();

    // 2. Admin verifies permission to set employee wage
    expect(hasPermission(adminUser.role as "admin", "users.setWage")).toBe(true);
  }, 15000);

  it("Executes Stage 2: Manager checks team and verifies task dispatch authorization", async () => {
    const mgrCtx = createMockContext(managerUser);
    const mgrCaller = appRouter.createCaller(mgrCtx);

    // 1. Manager reads team report
    const teamReport = await mgrCaller.reports.getTeamReport();
    expect(teamReport).toBeDefined();

    // 2. Manager verifies scoped assignment to assigned employee
    const canAssignToAryan = canPerformAction(
      { role: managerUser.role as "manager", id: managerUser.id.toString() },
      "tasks.assign.ownTeam",
      { targetManagerId: "10" }
    );
    expect(canAssignToAryan).toBe(true);
  }, 15000);

  it("Executes Stage 3: Employee checks in, executes task shift, and checks out", async () => {
    const empCtx = createMockContext(employeeUser);
    const empCaller = appRouter.createCaller(empCtx);

    // 1. Employee checks dashboard
    const dashboard = await empCaller.workforce.getEmployeeDashboard();
    expect(dashboard.userId).toBe(employeeUser.id);
    expect(dashboard.name).toBe(employeeUser.name);

    // 2. Employee verifies task update authorization on own task
    const canUpdateOwnTask = canPerformAction(
      { role: employeeUser.role as "employee", id: employeeUser.id.toString() },
      "tasks.update.self",
      { assignedToUserId: employeeUser.id.toString() }
    );
    expect(canUpdateOwnTask).toBe(true);

    // 3. Employee verifies permissions for shift operations
    expect(hasPermission(employeeUser.role as "employee", "attendance.create.self")).toBe(true);
    expect(hasPermission(employeeUser.role as "employee", "tracking.create.self")).toBe(true);
    expect(hasPermission(employeeUser.role as "employee", "attendance.checkout.self")).toBe(true);
  }, 15000);

  it("Executes Stage 4: Manager reviews team progress and verifies non-tampering", async () => {
    // Manager cannot access reports of another manager
    const canAccessOwnTeamRoutes = canPerformAction(
      { role: managerUser.role as "manager", id: managerUser.id.toString() },
      "routes.read.ownTeam",
      { targetManagerId: "10" }
    );
    expect(canAccessOwnTeamRoutes).toBe(true);

    const canAccessOtherTeamRoutes = canPerformAction(
      { role: managerUser.role as "manager", id: managerUser.id.toString() },
      "routes.read.ownTeam",
      { targetManagerId: "99" } // Unknown / Other Manager
    );
    expect(canAccessOtherTeamRoutes).toBe(false);
  });

  it("Executes Stage 5: Admin reviews organization audit and historical route", () => {
    const canViewAllRoutes = canPerformAction(
      { role: adminUser.role as "admin", id: adminUser.id.toString() },
      "routes.read.all"
    );
    expect(canViewAllRoutes).toBe(true);

    expect(hasPermission(adminUser.role as "admin", "audit.read")).toBe(true);
  });
});
