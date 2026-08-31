import { describe, expect, it } from "vitest";

import { shouldStartTrackingAfterAttendance } from "../lib/tracking-policy";

describe("attendance-triggered route tracking policy", () => {
  it("starts only after a successful attendance check-in", () => {
    expect(shouldStartTrackingAfterAttendance({ attendanceAction: "check-in", trackingActive: false })).toBe(true);
    expect(shouldStartTrackingAfterAttendance({ attendanceAction: "check-out", trackingActive: false })).toBe(false);
  });

  it("does not reinitialize a route already being tracked", () => {
    expect(shouldStartTrackingAfterAttendance({ attendanceAction: "check-in", trackingActive: true })).toBe(false);
  });
});
