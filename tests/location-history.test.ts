import { describe, expect, it } from "vitest";
import { canViewGpsHistory } from "../lib/field-access";

describe("Day-Wise GPS Location History Authorization", () => {
  it("allows Admin to view GPS history for any employee", () => {
    expect(
      canViewGpsHistory({
        viewerRole: "admin",
        viewerId: "admin-1",
        targetUserId: "emp-101",
        targetManagerId: "mgr-1",
      })
    ).toBe(true);
  });

  it("allows Manager to view GPS history for employees in their own team", () => {
    expect(
      canViewGpsHistory({
        viewerRole: "manager",
        viewerId: "mgr-1",
        targetUserId: "emp-101",
        targetManagerId: "mgr-1",
      })
    ).toBe(true);
  });

  it("DENIES Manager from viewing GPS history for employees in a different manager's team", () => {
    expect(
      canViewGpsHistory({
        viewerRole: "manager",
        viewerId: "mgr-1",
        targetUserId: "emp-202",
        targetManagerId: "mgr-2",
      })
    ).toBe(false);
  });

  it("allows Employee to view only their own GPS history", () => {
    expect(
      canViewGpsHistory({
        viewerRole: "employee",
        viewerId: "emp-1",
        targetUserId: "emp-1",
      })
    ).toBe(true);

    expect(
      canViewGpsHistory({
        viewerRole: "employee",
        viewerId: "emp-1",
        targetUserId: "emp-2",
      })
    ).toBe(false);
  });
});
