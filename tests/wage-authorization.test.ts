import { describe, expect, it } from "vitest";

import {
  canAccessAdminDashboard,
  canAccessManagerDashboard,
  canSetEmployeeWage,
  canViewEmployeeEarnings,
  canViewEmployeeRecord,
} from "../lib/field-access";

describe("Wage Authorization & RBAC Scoping", () => {
  describe("Admin Permissions", () => {
    it("allows Admin to access both Admin and Manager dashboards", () => {
      expect(canAccessAdminDashboard("admin")).toBe(true);
      expect(canAccessManagerDashboard("admin")).toBe(true);
    });

    it("allows Admin to set any employee's daily wage unrestricted", () => {
      expect(
        canSetEmployeeWage({
          actorRole: "admin",
          actorId: "admin-1",
          targetUserId: "emp-101",
          targetUserRole: "employee",
          targetManagerId: "mgr-1",
        })
      ).toBe(true);
    });

    it("allows Admin to set any manager's daily wage unrestricted", () => {
      expect(
        canSetEmployeeWage({
          actorRole: "admin",
          actorId: "admin-1",
          targetUserId: "mgr-1",
          targetUserRole: "manager",
        })
      ).toBe(true);
    });

    it("allows Admin to view any employee's earnings", () => {
      expect(
        canViewEmployeeEarnings({
          actorRole: "admin",
          actorId: "admin-1",
          targetUserId: "emp-101",
        })
      ).toBe(true);
    });
  });

  describe("Manager Permissions (Scoped to Assigned Team)", () => {
    it("allows Manager to access Manager dashboard but NOT full Admin dashboard", () => {
      expect(canAccessManagerDashboard("manager")).toBe(true);
      expect(canAccessAdminDashboard("manager")).toBe(false);
    });

    it("DENIES Manager from setting daily wage for any employee (Strictly Admin-Only Rule)", () => {
      expect(
        canSetEmployeeWage({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserId: "emp-101",
          targetUserRole: "employee",
          targetManagerId: "mgr-1",
        })
      ).toBe(false);
    });

    it("DENIES Manager from setting daily wage for unassigned employee", () => {
      expect(
        canSetEmployeeWage({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserId: "emp-102",
          targetUserRole: "employee",
          targetManagerId: undefined,
        })
      ).toBe(false);
    });

    it("DENIES Manager from setting daily wage for an employee belonging to a different manager", () => {
      expect(
        canSetEmployeeWage({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserId: "emp-202",
          targetUserRole: "employee",
          targetManagerId: "mgr-2",
        })
      ).toBe(false);
    });

    it("DENIES Manager from modifying another Manager's wage", () => {
      expect(
        canSetEmployeeWage({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserId: "mgr-2",
          targetUserRole: "manager",
        })
      ).toBe(false);
    });

    it("DENIES Manager from modifying an Admin's wage", () => {
      expect(
        canSetEmployeeWage({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserId: "admin-1",
          targetUserRole: "admin",
        })
      ).toBe(false);
    });

    it("allows Manager to view assigned team employee earnings and DENIES for other teams", () => {
      expect(
        canViewEmployeeEarnings({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserId: "emp-101",
          targetManagerId: "mgr-1",
        })
      ).toBe(true);

      expect(
        canViewEmployeeEarnings({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserId: "emp-202",
          targetManagerId: "mgr-2",
        })
      ).toBe(false);
    });
  });

  describe("Employee Permissions (Restricted Basic Access)", () => {
    it("DENIES Employee from accessing Admin or Manager dashboards", () => {
      expect(canAccessAdminDashboard("employee")).toBe(false);
      expect(canAccessManagerDashboard("employee")).toBe(false);
    });

    it("DENIES Employee from setting any wage (even their own)", () => {
      expect(
        canSetEmployeeWage({
          actorRole: "employee",
          actorId: "emp-1",
          targetUserId: "emp-1",
          targetUserRole: "employee",
        })
      ).toBe(false);

      expect(
        canSetEmployeeWage({
          actorRole: "employee",
          actorId: "emp-1",
          targetUserId: "emp-2",
          targetUserRole: "employee",
        })
      ).toBe(false);
    });

    it("allows Employee to view ONLY their own earnings and DENIES viewing other employees' earnings", () => {
      expect(
        canViewEmployeeEarnings({
          actorRole: "employee",
          actorId: "emp-1",
          targetUserId: "emp-1",
        })
      ).toBe(true);

      expect(
        canViewEmployeeEarnings({
          actorRole: "employee",
          actorId: "emp-1",
          targetUserId: "emp-2",
        })
      ).toBe(false);
    });

    it("allows Employee to view only their own profile record", () => {
      expect(
        canViewEmployeeRecord({
          viewerRole: "employee",
          viewerId: "emp-1",
          employeeId: "emp-1",
        })
      ).toBe(true);

      expect(
        canViewEmployeeRecord({
          viewerRole: "employee",
          viewerId: "emp-1",
          employeeId: "emp-2",
        })
      ).toBe(false);
    });
  });
});
