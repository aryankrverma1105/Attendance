import { describe, expect, it } from "vitest";

import { classifyLocationEvidence, routeDistanceKm } from "../lib/field-math";

describe("field attendance evidence policy", () => {
  it("marks precise non-mocked GPS evidence as verified", () => {
    expect(
      classifyLocationEvidence({
        latitude: 28.6139,
        longitude: 77.209,
        accuracy: 15,
        capturedAt: "2026-08-21T10:00:00.000Z",
        mocked: false,
      }),
    ).toBe("verified");
  });

  it("requires review for mocked or weak-accuracy GPS evidence", () => {
    expect(
      classifyLocationEvidence({
        latitude: 28.6139,
        longitude: 77.209,
        accuracy: 12,
        capturedAt: "2026-08-21T10:00:00.000Z",
        mocked: true,
      }),
    ).toBe("review");
    expect(
      classifyLocationEvidence({
        latitude: 28.6139,
        longitude: 77.209,
        accuracy: 120,
        capturedAt: "2026-08-21T10:00:00.000Z",
      }),
    ).toBe("review");
  });
});

describe("route distance calculation", () => {
  it("returns zero for fewer than two route points", () => {
    expect(routeDistanceKm([])).toBe(0);
  });

  it("calculates an approximately one-kilometre route from sequential GPS points", () => {
    const distance = routeDistanceKm([
      { id: "one", latitude: 28.6139, longitude: 77.209, accuracy: 10, capturedAt: "2026-08-21T10:00:00.000Z" },
      { id: "two", latitude: 28.6229, longitude: 77.209, accuracy: 10, capturedAt: "2026-08-21T10:10:00.000Z" },
    ]);
    expect(distance).toBeGreaterThan(0.9);
    expect(distance).toBeLessThan(1.1);
  });
});
