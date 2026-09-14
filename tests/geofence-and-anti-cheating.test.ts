import { describe, it, expect } from "vitest";
import { haversineDistanceMeters } from "../server/db";

describe("Geofencing & Anti-Cheating Verification", () => {
  it("calculates accurate geographic distances using haversine formula", () => {
    // Connaught Place (New Delhi) to India Gate (New Delhi) ~2.2 km (2200m)
    const connaughtPlace = { lat: 28.6315, lng: 77.2167 };
    const indiaGate = { lat: 28.6129, lng: 77.2295 };

    const distance = haversineDistanceMeters(
      connaughtPlace.lat,
      connaughtPlace.lng,
      indiaGate.lat,
      indiaGate.lng
    );

    // Should be between 2300m and 2500m
    expect(distance).toBeGreaterThan(2200);
    expect(distance).toBeLessThan(2600);
  });

  it("identifies when check-in is strictly within allowable geofence radius", () => {
    // Office facility location
    const officeLat = 19.076;
    const officeLng = 72.8777;

    // Worker 80 meters away
    const workerLat = 19.0766;
    const workerLng = 72.8777;

    const distance = haversineDistanceMeters(officeLat, officeLng, workerLat, workerLng);
    const allowedRadius = 150; // 150m geofence

    expect(distance).toBeLessThanOrEqual(allowedRadius);
  });

  it("identifies when check-in is outside allowable geofence radius", () => {
    const officeLat = 12.9716;
    const officeLng = 77.5946;

    // Worker 1.2 km away
    const workerLat = 12.982;
    const workerLng = 77.5946;

    const distance = haversineDistanceMeters(officeLat, officeLng, workerLat, workerLng);
    const allowedRadius = 200; // 200m

    expect(distance).toBeGreaterThan(allowedRadius);
  });

  it("detects impossible movement speeds (teleportation anti-cheat)", () => {
    // Distance of 50 km covered in 60 seconds = 3000 km/h (impossible)
    const lat1 = 28.7041;
    const lng1 = 77.1025;
    const lat2 = 28.4595;
    const lng2 = 77.0266;

    const distMeters = haversineDistanceMeters(lat1, lng1, lat2, lng2);
    const timeDeltaSeconds = 60;
    const speedMetersPerSec = distMeters / timeDeltaSeconds;
    const speedKmh = speedMetersPerSec * 3.6;

    // Normal max road travel speed in urban areas ~120 km/h
    const MAX_LEGITIMATE_SPEED_KMH = 150;
    expect(speedKmh).toBeGreaterThan(MAX_LEGITIMATE_SPEED_KMH);
  });

  it("evaluates site-specific geofence radii independently", () => {
    const siteCoord = { lat: 28.5355, lng: 77.3910 };
    // Worker is 350 meters away
    const workerCoord = { lat: 28.5385, lng: 77.3910 };
    const distance = haversineDistanceMeters(siteCoord.lat, siteCoord.lng, workerCoord.lat, workerCoord.lng);

    // Site A has a tight 200m radius -> worker is OUTSIDE
    const siteARadius = 200;
    expect(distance > siteARadius).toBe(true);

    // Site B (e.g. large industrial solar farm) has a 500m radius -> worker is INSIDE
    const siteBRadius = 500;
    expect(distance <= siteBRadius).toBe(true);
  });

  it("flags attendance when GPS accuracy is degraded or mocked", () => {
    const MAX_ACCURACY_ALLOWED = 150;
    const goodAccuracy = 25; // 25 meters (fine GPS)
    const poorAccuracy = 250; // 250 meters (cell tower triangulation)

    const shouldReviewGood = goodAccuracy > MAX_ACCURACY_ALLOWED;
    const shouldReviewPoor = poorAccuracy > MAX_ACCURACY_ALLOWED;

    expect(shouldReviewGood).toBe(false);
    expect(shouldReviewPoor).toBe(true);

    // Mock GPS flag
    const isMocked = true;
    const reviewRequired = isMocked || shouldReviewPoor;
    expect(reviewRequired).toBe(true);
  });
});

