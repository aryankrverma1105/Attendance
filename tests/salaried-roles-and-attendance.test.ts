import { describe, expect, it } from "vitest";
import { canParticipateInAttendance, canCreateUsers } from "../lib/field-access";

describe("Salaried Management & Attendance Eligibility", () => {
  it("enforces that ONLY field employees participate in attendance check-in", () => {
    expect(canParticipateInAttendance("employee")).toBe(true);
    expect(canParticipateInAttendance("admin")).toBe(false);
    expect(canParticipateInAttendance("manager")).toBe(false);
    expect(canParticipateInAttendance(undefined)).toBe(false);
  });

  it("enforces that ONLY Administrators can create new accounts", () => {
    expect(canCreateUsers("admin")).toBe(true);
    expect(canCreateUsers("manager")).toBe(false);
    expect(canCreateUsers("employee")).toBe(false);
    expect(canCreateUsers(undefined)).toBe(false);
  });
});
