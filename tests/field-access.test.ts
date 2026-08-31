import { describe, expect, it } from "vitest";

import { canManageWorkforce, canViewEmployeeRecord, canViewTeamActivity } from "../lib/field-access";

describe("FieldPulse role access policy", () => {
  it("limits workforce administration to administrators", () => {
    expect(canManageWorkforce("admin")).toBe(true);
    expect(canManageWorkforce("manager")).toBe(false);
    expect(canManageWorkforce("employee")).toBe(false);
  });

  it("allows administrators to inspect employee records and employees to inspect only their own record", () => {
    expect(canViewEmployeeRecord({ viewerRole: "admin", viewerId: "admin-1", employeeId: "employee-1" })).toBe(true);
    expect(canViewEmployeeRecord({ viewerRole: "employee", viewerId: "employee-1", employeeId: "employee-1" })).toBe(true);
    expect(canViewEmployeeRecord({ viewerRole: "employee", viewerId: "employee-1", employeeId: "employee-2" })).toBe(false);
  });

  it("allows authorized team activity views only for managers and administrators", () => {
    expect(canViewTeamActivity("admin")).toBe(true);
    expect(canViewTeamActivity("manager")).toBe(true);
    expect(canViewTeamActivity("employee")).toBe(false);
  });
});
