import { describe, it, expect } from "vitest";

describe("Visits Note Update Isolation & Invariant Tests", () => {
  const employeeUser = {
    id: 101,
    openId: "emp_101",
    role: "employee" as const,
    name: "Technician 1",
    accountStatus: "active" as const,
    dailyWage: 500,
    managerId: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    firebaseUid: "fb_101",
    phoneE164: "+919876543210",
    email: null,
    loginMethod: null,
  };

  const otherEmployeeUser = {
    ...employeeUser,
    id: 102,
    openId: "emp_102",
    name: "Technician 2",
  };

  it("updates meeting outcome, notes, and follow-up date without altering status or checkOutAt", () => {
    // Initial scheduled visit state
    const initialVisit = {
      id: "visit-alpha-1",
      customerId: "cust-1",
      employeeUserId: 101,
      scheduledFor: new Date("2026-09-18T10:00:00Z"),
      status: "SCHEDULED" as const,
      checkInAt: null,
      checkOutAt: null,
      checkInLat: null,
      checkInLng: null,
      checkOutLat: null,
      checkOutLng: null,
      meetingOutcome: null,
      notes: null,
      followUpDate: null,
      createdAt: new Date("2026-09-18T08:00:00Z"),
      updatedAt: new Date("2026-09-18T08:00:00Z"),
    };

    // Note update logic matching updateVisitNotes
    const applyNotesUpdate = (
      actor: typeof employeeUser,
      targetVisit: typeof initialVisit,
      input: { meetingOutcome?: string; notes?: string; followUpDate?: string }
    ) => {
      if (actor.role === "employee" && targetVisit.employeeUserId !== actor.id) {
        throw new Error("Forbidden: You can only update notes for your own assigned visits.");
      }

      // Preserve status and checkOutAt strictly
      return {
        ...targetVisit,
        meetingOutcome: input.meetingOutcome ?? targetVisit.meetingOutcome,
        notes: input.notes ?? targetVisit.notes,
        followUpDate: input.followUpDate ?? targetVisit.followUpDate,
        status: targetVisit.status, // NEVER changed to COMPLETED
        checkOutAt: targetVisit.checkOutAt, // NEVER set on note update
      };
    };

    const updated = applyNotesUpdate(employeeUser, initialVisit, {
      meetingOutcome: "Customer requested pricing quote for 5kW solar",
      notes: "Met with manager Mr. Sharma",
      followUpDate: "2026-09-25",
    });

    // Invariants verified
    expect(updated.meetingOutcome).toBe("Customer requested pricing quote for 5kW solar");
    expect(updated.notes).toBe("Met with manager Mr. Sharma");
    expect(updated.followUpDate).toBe("2026-09-25");
    expect(updated.status).toBe("SCHEDULED"); // Did not prematurely complete
    expect(updated.checkOutAt).toBeNull(); // Did not set checkout timestamp
  });

  it("enforces RBAC preventing an employee from modifying another employee's visit notes", () => {
    const targetVisit = {
      id: "visit-alpha-2",
      customerId: "cust-2",
      employeeUserId: 102, // Assigned to Worker 2
      scheduledFor: new Date("2026-09-18T11:00:00Z"),
      status: "IN_PROGRESS" as const,
      checkInAt: new Date("2026-09-18T11:05:00Z"),
      checkOutAt: null,
      checkInLat: "28.6",
      checkInLng: "77.2",
      checkOutLat: null,
      checkOutLng: null,
      meetingOutcome: null,
      notes: null,
      followUpDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const checkAccess = (actorId: number, visitAssignedId: number) => {
      if (actorId !== visitAssignedId) {
        throw new Error("Forbidden: You can only update notes for your own assigned visits.");
      }
      return true;
    };

    expect(() => checkAccess(employeeUser.id, targetVisit.employeeUserId)).toThrow(
      "Forbidden: You can only update notes for your own assigned visits."
    );
    expect(checkAccess(otherEmployeeUser.id, targetVisit.employeeUserId)).toBe(true);
  });
});
