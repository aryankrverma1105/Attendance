import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import type { FieldWorkspace, LocationEvidence, RoutePoint } from "@/lib/field-types";

export const BACKGROUND_LOCATION_TASK = "fieldpulse-background-location";
export const ROUTE_POINTS_STORAGE_KEY = "fieldpulse.route_points.v1";

import { enqueueOperation, flushOfflineQueue } from "@/lib/offline-sync";

export function isValidGpsCoordinate(lat: number, lng: number, accuracy?: number | null): boolean {
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (accuracy !== undefined && accuracy !== null && accuracy > 200) return false; // Filter poor accuracy
  return true;
}

export async function getStoredRoutePoints(): Promise<RoutePoint[]> {
  try {
    const raw = await AsyncStorage.getItem(ROUTE_POINTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function appendBackgroundPoints(locations: Location.LocationObject[]) {
  const validLocations = locations.filter((loc) =>
    isValidGpsCoordinate(loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy)
  );
  if (validLocations.length === 0) return;

  const newPoints: RoutePoint[] = validLocations.map((location) => ({
    id: `route-${location.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    capturedAt: new Date(location.timestamp).toISOString(),
    mocked: location.mocked,
  }));

  // Dedicated storage key avoids read-modify-write races with foreground workspace updates
  try {
    const rawExisting = await AsyncStorage.getItem(ROUTE_POINTS_STORAGE_KEY);
    const existingPoints: RoutePoint[] = rawExisting ? JSON.parse(rawExisting) : [];
    const updated = [...existingPoints, ...newPoints].slice(-1000);
    await AsyncStorage.setItem(ROUTE_POINTS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("[BackgroundLocation] Storage append error:", err);
  }

  // Queue for server synchronization
  for (const point of newPoints) {
    await enqueueOperation("GPS_POINT", point, "low").catch(() => {});
  }

  // Flush queued points when online
  try {
    await flushOfflineQueue().catch(() => {});
  } catch {}
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data) return;
    const payload = data as { locations?: Location.LocationObject[] };
    if (payload.locations?.length) await appendBackgroundPoints(payload.locations);
  });
}

export function makeLocationEvidence(location: Location.LocationObject): LocationEvidence {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    capturedAt: new Date(location.timestamp).toISOString(),
    mocked: location.mocked,
  };
}
