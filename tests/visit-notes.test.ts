import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL = "mysql://mock:mock@localhost:3306/fieldpulse_test";

let mockDbData: any[] = [];
let lastUpdatesApplied: any = null;

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mockDbData),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((updates: any) => {
      lastUpdatesApplied = updates;
      if (mockDbData.length > 0) {
        mockDbData = [{ ...mockDbData[0], ...updates }];
      }
      return {
        where: vi.fn(async () => ({})),
      };
    }),
  })),
};

vi.mock("mysql2", () => ({
  default: {
    createPool: vi.fn(() => ({})),
  },
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => mockDb),
}));

import { updateVisitNotes } from "../server/db";
import type { User } from "../drizzle/schema";

describe("Visits Note Update Isolation & Invariant Tests (Real server/db)", () => {
  const employeeUser: User = {
    id: 101,
    openId: "emp_101",
    role: "employee",
    name: "Technician 1",
    accountStatus: "active",
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

  const otherEmployeeUser: User = {
    ...employeeUser,
    id: 102,
    openId: "emp_102",
    name: "Technician 2",
  };

  const adminUser: User = {
    ...employeeUser,
    id: 1,
    openId: "admin_1",
    role: "admin",
    name: "Admin User",
  };

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbData = [{ ...initialVisit }];
    lastUpdatesApplied = null;
  });

  it("calls real updateVisitNotes and updates notes/outcome without altering status or checkOutAt", async () => {
    const result = await updateVisitNotes(employeeUser, "visit-alpha-1", {
      meetingOutcome: "Customer requested pricing quote for 5kW solar",
      notes: "Met with manager Mr. Sharma",
      followUpDate: "2026-09-25",
    });

    // Invariants verified on real function result
    expect(result.meetingOutcome).toBe("Customer requested pricing quote for 5kW solar");
    expect(result.notes).toBe("Met with manager Mr. Sharma");
    expect(result.followUpDate).toBe("2026-09-25");
    expect(result.status).toBe("SCHEDULED"); // Invariant: status is NEVER changed to COMPLETED
    expect(result.checkOutAt).toBeNull(); // Invariant: checkOutAt is NEVER set

    // DB update set check: confirm neither status nor checkOutAt was ever passed to db.update
    expect(lastUpdatesApplied).toBeDefined();
    expect(lastUpdatesApplied.status).toBeUndefined();
    expect(lastUpdatesApplied.checkOutAt).toBeUndefined();
  });

  it("calls real updateVisitNotes and enforces employee RBAC (throws when employee modifies unassigned visit)", async () => {
    mockDbData = [{ ...initialVisit, employeeUserId: 102 }]; // assigned to Worker 2

    // Employee 101 attempts to update Worker 2's visit -> real function throws Forbidden
    await expect(
      updateVisitNotes(employeeUser, "visit-alpha-1", {
        notes: "Unauthorized note modification attempt",
      })
    ).rejects.toThrow("Forbidden: You can only update notes for your own assigned visits.");

    // Worker 2 (owner) calling real updateVisitNotes succeeds
    const ownerResult = await updateVisitNotes(otherEmployeeUser, "visit-alpha-1", {
      notes: "Authorized owner note update",
    });
    expect(ownerResult.notes).toBe("Authorized owner note update");
  });

  it("calls real updateVisitNotes and allows Admin to update notes on any employee's visit", async () => {
    mockDbData = [{ ...initialVisit, employeeUserId: 101 }];

    const adminResult = await updateVisitNotes(adminUser, "visit-alpha-1", {
      notes: "Admin review note added",
    });
    expect(adminResult.notes).toBe("Admin review note added");
    expect(adminResult.status).toBe("SCHEDULED");
  });

  it("throws Visit not found when visit ID does not exist in DB", async () => {
    mockDbData = []; // No visit found

    await expect(
      updateVisitNotes(employeeUser, "nonexistent-id", {
        notes: "Missing visit note",
      })
    ).rejects.toThrow("Visit not found.");
  });
});
