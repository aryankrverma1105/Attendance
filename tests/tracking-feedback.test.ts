import { describe, expect, it } from "vitest";

import { shouldEscalateTrackingPermission, trackingOutcomeMessage } from "../lib/tracking-feedback";

describe("attendance tracking feedback", () => {
  it("escalates only a denied tracking permission", () => {
    expect(shouldEscalateTrackingPermission({ mode: "idle", reason: "permission-denied" })).toBe(true);
    expect(shouldEscalateTrackingPermission({ mode: "idle", reason: "services-disabled" })).toBe(false);
    expect(shouldEscalateTrackingPermission({ mode: "foreground" })).toBe(false);
  });

  it("confirms background route tracking after check-in and stop after check-out", () => {
    expect(trackingOutcomeMessage({ action: "check-in", mode: "background" })).toContain("Route tracking has started");
    expect(trackingOutcomeMessage({ action: "check-out", trackingStopped: true })).toContain("route tracking has stopped");
  });
});
