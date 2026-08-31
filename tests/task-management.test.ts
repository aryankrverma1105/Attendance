import { describe, expect, it } from "vitest";
import {
  canAssignTasks,
  canAssignTaskToWorker,
  canUpdateTaskStatus,
} from "../lib/field-access";

describe("Task Assignment & Work Order Permissions", () => {
  describe("Task Assignment Creation", () => {
    it("allows Admin and Manager to assign tasks and denies Employee", () => {
      expect(canAssignTasks("admin")).toBe(true);
      expect(canAssignTasks("manager")).toBe(true);
      expect(canAssignTasks("employee")).toBe(false);
    });

    it("allows Admin to assign a task to any field employee", () => {
      expect(
        canAssignTaskToWorker({
          actorRole: "admin",
          actorId: "admin-1",
          targetUserRole: "employee",
          targetManagerId: "mgr-2",
        })
      ).toBe(true);
    });

    it("allows Manager to assign a task to employees in their own team (targetManagerId === actorId)", () => {
      expect(
        canAssignTaskToWorker({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserRole: "employee",
          targetManagerId: "mgr-1",
        })
      ).toBe(true);
    });

    it("DENIES Manager from assigning tasks to employees in other managers' teams", () => {
      expect(
        canAssignTaskToWorker({
          actorRole: "manager",
          actorId: "mgr-1",
          targetUserRole: "employee",
          targetManagerId: "mgr-2",
        })
      ).toBe(false);
    });

    it("DENIES assigning tasks to non-employees (e.g. other Admins or Managers)", () => {
      expect(
        canAssignTaskToWorker({
          actorRole: "admin",
          actorId: "admin-1",
          targetUserRole: "manager",
        })
      ).toBe(false);
    });
  });

  describe("Task Status Lifecycle", () => {
    it("allows assigned Employee to update status of their own task", () => {
      expect(
        canUpdateTaskStatus({
          actorRole: "employee",
          actorId: "emp-1",
          assignedToUserId: "emp-1",
        })
      ).toBe(true);
    });

    it("DENIES Employee from updating tasks assigned to another employee", () => {
      expect(
        canUpdateTaskStatus({
          actorRole: "employee",
          actorId: "emp-1",
          assignedToUserId: "emp-2",
        })
      ).toBe(false);
    });

    it("allows Admin and Manager to update task status", () => {
      expect(
        canUpdateTaskStatus({
          actorRole: "admin",
          actorId: "admin-1",
          assignedToUserId: "emp-2",
        })
      ).toBe(true);

      expect(
        canUpdateTaskStatus({
          actorRole: "manager",
          actorId: "mgr-1",
          assignedToUserId: "emp-2",
        })
      ).toBe(true);
    });
  });
});
