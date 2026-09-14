import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import type { FieldWorkspace, LocationEvidence, RoutePoint } from "@/lib/field-types";

export const BACKGROUND_LOCATION_TASK = "fieldpulse-background-location";
const FIELD_WORKSPACE_KEY = "fieldpulse.workspace.v1";

import { enqueueOperation } from "@/lib/offline-sync";

export function isValidGpsCoordinate(lat: number, lng: number, accuracy?: number | null): boolean {
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (accuracy !== undefined && accuracy !== null && accuracy > 200) return false; // Filter poor accuracy
  return true;
}

async function appendBackgroundPoints(locations: Location.LocationObject[]) {
  const workspaceValue = await AsyncStorage.getItem(FIELD_WORKSPACE_KEY);
  if (!workspaceValue) return;
  const workspace = JSON.parse(workspaceValue) as Partial<FieldWorkspace>;
  const existingPoints = workspace.routePoints ?? [];
  const validLocations = locations.filter((loc) =>
    isValidGpsCoordinate(loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy)
  );

  const newPoints: RoutePoint[] = validLocations.map((location) => ({
    id: `route-${location.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    capturedAt: new Date(location.timestamp).toISOString(),
    mocked: location.mocked,
  }));

  const nextWorkspace = { ...workspace, routePoints: [...existingPoints, ...newPoints].slice(-1000) };
  await AsyncStorage.setItem(FIELD_WORKSPACE_KEY, JSON.stringify(nextWorkspace));

  // Also queue for server synchronization
  for (const point of newPoints) {
    await enqueueOperation("GPS_POINT", point, "low").catch(() => {});
  }
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
