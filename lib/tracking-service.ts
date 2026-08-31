import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { BACKGROUND_LOCATION_TASK, makeLocationEvidence } from "@/lib/location-tracking";
import type { LocationEvidence } from "@/lib/field-types";

export type TrackingMode = "idle" | "foreground" | "background";
export type TrackingStartResult = { mode: TrackingMode; reason?: "permission-denied" | "services-disabled" | "unavailable" | "error" };

let foregroundSubscription: Location.LocationSubscription | null = null;

function foregroundOptions() {
  return { accuracy: Location.Accuracy.Balanced, timeInterval: 30000, distanceInterval: 25 } as const;
}

export async function startManagedRouteTracking(onEvidence: (evidence: LocationEvidence) => void): Promise<TrackingStartResult> {
  const foregroundPermission = await Location.requestForegroundPermissionsAsync();
  if (foregroundPermission.status !== "granted") return { mode: "idle", reason: "permission-denied" };
  if (!(await Location.hasServicesEnabledAsync())) return { mode: "idle", reason: "services-disabled" };

  if (Platform.OS === "android") await Location.enableNetworkProviderAsync().catch(() => undefined);
  const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  onEvidence(makeLocationEvidence(initial));

  if (Platform.OS !== "web" && (await TaskManager.isAvailableAsync())) {
    const backgroundPermission = await Location.requestBackgroundPermissionsAsync();
    if (backgroundPermission.status === "granted") {
      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (!alreadyStarted) {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 60000,
          distanceInterval: 35,
          deferredUpdatesDistance: 50,
          deferredUpdatesInterval: 90000,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: "Sologix route tracking",
            notificationBody: "Route tracking is active for your signed-in field shift.",
          },
        });
      }
      return { mode: "background" };
    }
  }

  foregroundSubscription?.remove();
  foregroundSubscription = await Location.watchPositionAsync(foregroundOptions(), (location) => onEvidence(makeLocationEvidence(location)));
  return { mode: "foreground" };
}

export async function stopManagedRouteTracking() {
  foregroundSubscription?.remove();
  foregroundSubscription = null;
  if (Platform.OS !== "web" && (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK))) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
