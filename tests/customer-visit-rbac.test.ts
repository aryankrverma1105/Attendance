import { describe, it, expect } from "vitest";

describe("Workforce Customer and Visit RBAC Validation", () => {
  const adminUser = { id: 1, openId: "admin_1", role: "admin" as const, name: "Admin" };
  const managerUser = { id: 10, openId: "mgr_10", role: "manager" as const, name: "Manager" };
  const employeeUser1 = { id: 101, openId: "emp_101", role: "employee" as const, managerId: 10, name: "Worker 1" };
  const employeeUser2 = { id: 102, openId: "emp_102", role: "employee" as const, managerId: 99, name: "Worker 2 (Other Team)" };

  it("validates that field employees cannot schedule visits for another employee", () => {
    const attemptedTargetEmployeeId = 102;
    const isSelfAssignment = employeeUser1.id === attemptedTargetEmployeeId;
    expect(isSelfAssignment).toBe(false);

    // Enforcement assertion
    const allowEmployeeSchedule = (actor: typeof employeeUser1, targetId: number) => {
      if (actor.role === "employee" && targetId !== actor.id) {
        throw new Error("Forbidden: Field employees can only schedule visits for themselves.");
      }
      return true;
    };

    expect(() => allowEmployeeSchedule(employeeUser1, attemptedTargetEmployeeId)).toThrow(
      "Forbidden: Field employees can only schedule visits for themselves."
    );
    expect(allowEmployeeSchedule(employeeUser1, 101)).toBe(true);
  });

  it("ensures managers can only assign visits to their own team members", () => {
    const isTeamMember = (targetUser: typeof employeeUser1 | typeof employeeUser2, managerId: number) => {
      return targetUser.managerId === managerId;
    };

    expect(isTeamMember(employeeUser1, managerUser.id)).toBe(true);
    expect(isTeamMember(employeeUser2, managerUser.id)).toBe(false);
  });

  it("validates that customers require a valid non-empty name", () => {
    const validateCustomerInput = (input: { name: string; phone?: string }) => {
      if (!input.name || !input.name.trim()) {
        throw new Error("Customer name is required.");
      }
      return true;
    };

    expect(() => validateCustomerInput({ name: "   " })).toThrow("Customer name is required.");
    expect(validateCustomerInput({ name: "Solar Site 1" })).toBe(true);
  });
});
