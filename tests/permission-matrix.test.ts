import { describe, expect, it } from "vitest";
import {
  hasPermission,
  canPerformAction,
  ROLE_PERMISSIONS,
  type AppPermission,
} from "../lib/field-access";

describe("Centralized Permission Matrix (Phase 4.5)", () => {
  describe("Admin Static & Contextual Permissions", () => {
    it("grants Admin all organization-level administrative permissions", () => {
      expect(hasPermission("admin", "users.read.all")).toBe(true);
      expect(hasPermission("admin", "users.create")).toBe(true);
      expect(hasPermission("admin", "users.update")).toBe(true);
      expect(hasPermission("admin", "users.suspend")).toBe(true);
      expect(hasPermission("admin", "users.deactivate")).toBe(true);
      expect(hasPermission("admin", "tasks.read.all")).toBe(true);
      expect(hasPermission("admin", "tasks.assign.all")).toBe(true);
      expect(hasPermission("admin", "reports.read.all")).toBe(true);
      expect(hasPermission("admin", "routes.read.all")).toBe(true);
      expect(hasPermission("admin", "audit.read")).toBe(true);
    });

    it("DENIES Admin from employee field execution permissions (Check-In & Tracking)", () => {
      expect(hasPermission("admin", "attendance.create.self")).toBe(false);
      expect(hasPermission("admin", "attendance.checkout.self")).toBe(false);
      expect(hasPermission("admin", "tracking.create.self")).toBe(false);
    });
  });

  describe("Manager Static & Contextual Permissions", () => {
    it("grants Manager team management and dispatch permissions", () => {
      expect(hasPermission("manager", "team.read.own")).toBe(true);
      expect(hasPermission("manager", "tasks.read.ownTeam")).toBe(true);
      expect(hasPermission("manager", "tasks.create")).toBe(true);
      expect(hasPermission("manager", "tasks.assign.ownTeam")).toBe(true);
      expect(hasPermission("manager", "customers.read")).toBe(true);
      expect(hasPermission("manager", "customers.create")).toBe(true);
      expect(hasPermission("manager", "map.read.ownTeam")).toBe(true);
      expect(hasPermission("manager", "reports.read.ownTeam")).toBe(true);
    });

    it("DENIES Manager from system-level administration (User create, suspend, delete, org reports)", () => {
      expect(hasPermission("manager", "users.create")).toBe(false);
      expect(hasPermission("manager", "users.suspend")).toBe(false);
      expect(hasPermission("manager", "users.deactivate")).toBe(false);
      expect(hasPermission("manager", "reports.read.all")).toBe(false);
      expect(hasPermission("manager", "routes.read.all")).toBe(false);
      expect(hasPermission("manager", "audit.read")).toBe(false);
    });

    it("DENIES Manager from employee field execution permissions", () => {
      expect(hasPermission("manager", "attendance.create.self")).toBe(false);
      expect(hasPermission("manager", "attendance.checkout.self")).toBe(false);
      expect(hasPermission("manager", "tracking.create.self")).toBe(false);
    });

    it("enforces contextual team scoping for Manager", () => {
      // Allowed for own team
      expect(
        canPerformAction(
          { role: "manager", id: "mgr-1" },
          "tasks.assign.ownTeam",
          { targetManagerId: "mgr-1" }
        )
      ).toBe(true);

      // Denied for another manager's team
      expect(
        canPerformAction(
          { role: "manager", id: "mgr-1" },
          "tasks.assign.ownTeam",
          { targetManagerId: "mgr-2" }
        )
      ).toBe(false);
    });
  });

  describe("Employee Static & Contextual Permissions", () => {
    it("grants Employee field execution permissions", () => {
      expect(hasPermission("employee", "attendance.create.self")).toBe(true);
      expect(hasPermission("employee", "attendance.checkout.self")).toBe(true);
      expect(hasPermission("employee", "tasks.read.self")).toBe(true);
      expect(hasPermission("employee", "tasks.update.self")).toBe(true);
      expect(hasPermission("employee", "visits.read.self")).toBe(true);
      expect(hasPermission("employee", "visits.create.self")).toBe(true);
      expect(hasPermission("employee", "tracking.create.self")).toBe(true);
      expect(hasPermission("employee", "tracking.read.self")).toBe(true);
    });

    it("DENIES Employee from all administrative, management, and cross-user permissions", () => {
      expect(hasPermission("employee", "users.read.all")).toBe(false);
      expect(hasPermission("employee", "users.create")).toBe(false);
      expect(hasPermission("employee", "tasks.assign.all")).toBe(false);
      expect(hasPermission("employee", "team.read.own")).toBe(false);
      expect(hasPermission("employee", "reports.read.all")).toBe(false);
      expect(hasPermission("employee", "audit.read")).toBe(false);
    });

    it("enforces self-scoping for Employee", () => {
      expect(
        canPerformAction(
          { role: "employee", id: "emp-1" },
          "tasks.update.self",
          { assignedToUserId: "emp-1" }
        )
      ).toBe(true);

      expect(
        canPerformAction(
          { role: "employee", id: "emp-1" },
          "tasks.update.self",
          { assignedToUserId: "emp-2" }
        )
      ).toBe(false);
    });
  });
});
