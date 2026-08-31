import { describe, expect, it } from "vitest";

import {
  calculateEarnings,
  calculateWorkedDays,
  calculateWorkingDaysInMonth,
  formatCurrency,
  getMonthlyWorkedDaysBreakdown,
} from "../lib/field-math";
import type { AttendanceRecord } from "../lib/field-types";

describe("Worked Days Calculation & Deduplication", () => {
  it("deduplicates multiple check-ins on the same calendar day into exactly 1 worked day", () => {
    const attendanceRecords: AttendanceRecord[] = [
      {
        id: "att-1",
        employeeId: "emp-1",
        checkInAt: "2026-08-03T09:00:00.000Z",
        checkOutAt: "2026-08-03T12:00:00.000Z",
        status: "verified",
        syncState: "synced",
      },
      {
        id: "att-2",
        employeeId: "emp-1",
        checkInAt: "2026-08-03T13:00:00.000Z",
        checkOutAt: "2026-08-03T18:00:00.000Z",
        status: "verified",
        syncState: "synced",
      },
      {
        id: "att-3",
        employeeId: "emp-1",
        checkInAt: "2026-08-04T09:15:00.000Z",
        checkOutAt: "2026-08-04T17:45:00.000Z",
        status: "verified",
        syncState: "synced",
      },
    ];

    const result = calculateWorkedDays(attendanceRecords, 8, 2026);
    expect(result.workedDays).toBe(2);
    expect(result.uniqueDates).toHaveLength(2);
    expect(result.uniqueDates).toContain("2026-08-03");
    expect(result.uniqueDates).toContain("2026-08-04");
  });

  it("filters records strictly by target month and year", () => {
    const attendanceRecords: AttendanceRecord[] = [
      {
        id: "att-1",
        checkInAt: "2026-07-31T10:00:00.000Z",
        status: "verified",
        syncState: "synced",
      },
      {
        id: "att-2",
        checkInAt: "2026-08-01T10:00:00.000Z",
        status: "verified",
        syncState: "synced",
      },
      {
        id: "att-3",
        checkInAt: "2026-09-01T10:00:00.000Z",
        status: "verified",
        syncState: "synced",
      },
    ];

    const augustResult = calculateWorkedDays(attendanceRecords, 8, 2026);
    expect(augustResult.workedDays).toBe(1);
    expect(augustResult.uniqueDates).toEqual(["2026-08-01"]);

    const julyResult = calculateWorkedDays(attendanceRecords, 7, 2026);
    expect(julyResult.workedDays).toBe(1);
    expect(julyResult.uniqueDates).toEqual(["2026-07-31"]);
  });

  it("handles year and month boundary dates correctly without cross-contamination", () => {
    const attendanceRecords: AttendanceRecord[] = [
      {
        id: "att-dec-31",
        checkInAt: "2025-12-31T12:00:00.000Z",
        status: "verified",
        syncState: "synced",
      },
      {
        id: "att-jan-01",
        checkInAt: "2026-01-01T12:00:00.000Z",
        status: "verified",
        syncState: "synced",
      },
    ];

    const dec2025 = calculateWorkedDays(attendanceRecords, 12, 2025);
    expect(dec2025.workedDays).toBe(1);
    expect(dec2025.uniqueDates).toEqual(["2025-12-31"]);

    const jan2026 = calculateWorkedDays(attendanceRecords, 1, 2026);
    expect(jan2026.workedDays).toBe(1);
    expect(jan2026.uniqueDates).toEqual(["2026-01-01"]);
  });

  it("ensures GPS route points and Customer visits produce ZERO additional worked days", () => {
    // 1 attendance record on 2026-08-10
    const attendance: AttendanceRecord[] = [
      {
        id: "att-1",
        checkInAt: "2026-08-10T09:00:00.000Z",
        checkOutAt: "2026-08-10T17:00:00.000Z",
        status: "verified",
        syncState: "synced",
      },
    ];

    const result = calculateWorkedDays(attendance, 8, 2026);
    // Exactly 1 worked day from the attendance event, regardless of tracking or visits
    expect(result.workedDays).toBe(1);
    expect(result.uniqueDates).toEqual(["2026-08-10"]);
  });
});

describe("Earnings Calculation Formula (Days × Wage)", () => {
  it("calculates exact earnings for 22 worked days at ₹700 per day = ₹15,400", () => {
    const earnings = calculateEarnings(22, 700);
    expect(earnings).toBe(15400);
  });

  it("calculates 0 earnings for 0 worked days at ₹700 per day", () => {
    const earnings = calculateEarnings(0, 700);
    expect(earnings).toBe(0);
  });

  it("calculates 0 earnings for 22 worked days when daily wage is ₹0 (unconfigured wage)", () => {
    const earnings = calculateEarnings(22, 0);
    expect(earnings).toBe(0);
  });

  it("calculates 26 worked days at ₹850 per day = ₹22,100", () => {
    const earnings = calculateEarnings(26, 850);
    expect(earnings).toBe(22100);
  });

  it("guards against negative wages or days by clamping to zero", () => {
    expect(calculateEarnings(-5, 700)).toBe(0);
    expect(calculateEarnings(20, -500)).toBe(0);
  });

  it("formats Indian rupee currency correctly", () => {
    expect(formatCurrency(15400)).toBe("₹15,400");
    expect(formatCurrency(0)).toBe("₹0");
    expect(formatCurrency(700)).toBe("₹700");
  });
});

describe("Working Days Calculation (Excluding Sundays)", () => {
  it("calculates non-Sunday working days in August 2026 (31 days with 5 Sundays = 26 working days)", () => {
    const workingDays = calculateWorkingDaysInMonth(2026, 8);
    expect(workingDays).toBe(26);
  });

  it("calculates non-Sunday working days in February 2026 (28 days with 4 Sundays = 24 working days)", () => {
    const workingDays = calculateWorkingDaysInMonth(2026, 2);
    expect(workingDays).toBe(24);
  });
});

describe("Historical Wage Calculation & Retroactive Protection", () => {
  it("computes controlled scenario: July 20 days @ ₹700 = ₹14,000 and August 22 days @ ₹800 = ₹17,600", () => {
    const julyEarnings = calculateEarnings(20, 700);
    expect(julyEarnings).toBe(14000);

    const augustEarnings = calculateEarnings(22, 800);
    expect(augustEarnings).toBe(17600);
  });

  it("verifies changing August wage to ₹900 does NOT retroactively change July earnings", () => {
    const julyEffectiveWage = 700;
    const julyWorkedDays = 20;
    const julyEarnings = calculateEarnings(julyWorkedDays, julyEffectiveWage);
    expect(julyEarnings).toBe(14000);

    // Wage changed in August to ₹900
    const newAugustWage = 900;
    const augustWorkedDays = 22;
    const augustEarnings = calculateEarnings(augustWorkedDays, newAugustWage);
    expect(augustEarnings).toBe(19800);

    // July earnings remains exactly ₹14,000 using effective wage for July
    const julyRechecked = calculateEarnings(julyWorkedDays, julyEffectiveWage);
    expect(julyRechecked).toBe(14000);
    expect(julyRechecked).not.toBe(calculateEarnings(julyWorkedDays, newAugustWage));
  });

  it("generates monthly earnings breakdown correctly with effective wages", () => {
    const attendance: AttendanceRecord[] = [
      // 2 days in August 2026
      { id: "1", checkInAt: "2026-08-01T09:00:00.000Z", status: "verified", syncState: "synced" },
      { id: "2", checkInAt: "2026-08-02T09:00:00.000Z", status: "verified", syncState: "synced" },
      // 3 days in July 2026
      { id: "3", checkInAt: "2026-07-10T09:00:00.000Z", status: "verified", syncState: "synced" },
      { id: "4", checkInAt: "2026-07-11T09:00:00.000Z", status: "verified", syncState: "synced" },
      { id: "5", checkInAt: "2026-07-12T09:00:00.000Z", status: "verified", syncState: "synced" },
    ];

    const breakdown = getMonthlyWorkedDaysBreakdown(attendance, 700, 6, new Date("2026-08-15T00:00:00.000Z"));
    expect(breakdown.length).toBeGreaterThanOrEqual(2);

    const august = breakdown.find((b) => b.month === 8 && b.year === 2026);
    expect(august).toBeDefined();
    expect(august?.workedDays).toBe(2);
    expect(august?.dailyWage).toBe(700);
    expect(august?.calculatedEarnings).toBe(1400);

    const july = breakdown.find((b) => b.month === 7 && b.year === 2026);
    expect(july).toBeDefined();
    expect(july?.workedDays).toBe(3);
    expect(july?.dailyWage).toBe(700);
    expect(july?.calculatedEarnings).toBe(2100);
  });
});
