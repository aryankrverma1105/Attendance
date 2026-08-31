import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import type { FieldWorkspace, LocationEvidence, RoutePoint } from "@/lib/field-types";

export const BACKGROUND_LOCATION_TASK = "fieldpulse-background-location";
const FIELD_WORKSPACE_KEY = "fieldpulse.workspace.v1";

async function appendBackgroundPoints(locations: Location.LocationObject[]) {
  const workspaceValue = await AsyncStorage.getItem(FIELD_WORKSPACE_KEY);
  if (!workspaceValue) return;
  const workspace = JSON.parse(workspaceValue) as Partial<FieldWorkspace>;
  const existingPoints = workspace.routePoints ?? [];
  const newPoints: RoutePoint[] = locations.map((location) => ({
    id: `route-${location.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    capturedAt: new Date(location.timestamp).toISOString(),
    mocked: location.mocked,
  }));
  const nextWorkspace = { ...workspace, routePoints: [...existingPoints, ...newPoints].slice(-1000) };
  await AsyncStorage.setItem(FIELD_WORKSPACE_KEY, JSON.stringify(nextWorkspace));
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
