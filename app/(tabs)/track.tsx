import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Network from "expo-network";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { routeDistanceKm, useFieldData } from "@/lib/field-data";

export default function TrackScreen() {
  const router = useRouter();
  const { data, startRouteTracking, stopRouteTracking } = useFieldData();
  const network = Network.useNetworkState();
  const [isWorking, setIsWorking] = useState(false);
  const distance = routeDistanceKm(data.routePoints);
  const lastPoint = data.routePoints.at(-1);
  const online = Boolean(network.isInternetReachable);

  const startTracking = async () => {
    setIsWorking(true);
    try {
      const result = await startRouteTracking();
      if (result.mode === "idle") {
        Alert.alert(result.reason === "services-disabled" ? "Location unavailable" : "Location permission required", result.reason === "services-disabled" ? "Enable location services, then restart route tracking." : "Allow precise location to start your field route.");
      } else if (result.mode === "foreground") {
        Alert.alert("Foreground tracking enabled", "Background permission was not granted or is unavailable, so tracking will update while Sologix remains open.");
      }
    } finally {
      setIsWorking(false);
    }
  };

  const stopTracking = async () => {
    setIsWorking(true);
    try {
      await stopRouteTracking();
    } finally {
      setIsWorking(false);
    }
  };

  const trackingState = useMemo(() => {
    if (!data.trackingActive) return { label: "Tracking paused", tone: "neutral" as const, body: "Start route tracking only while you are on approved field work." };
    if (data.trackingMode === "background") return { label: "Background tracking", tone: "success" as const, body: "Location updates continue under the Android foreground-service notification." };
    return { label: "Foreground tracking", tone: "warning" as const, body: "Updates continue while Sologix remains open. Enable background permission in a production build for full route history." };
  }, [data.trackingActive, data.trackingMode]);

  return <ScreenContainer containerClassName="bg-background" className="flex-1"><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.header}><View><Text style={styles.kicker}>ROUTE INTELLIGENCE</Text><Text style={styles.title}>Live tracking</Text><Text style={styles.subtitle}>Starts after attendance check-in, with your device permission.</Text></View><Pressable onPress={() => router.push("/offline-queue")} style={styles.queueButton}><MaterialIcons color="#D78B1C" name="sync" size={20} /><Text style={styles.queueCount}>{data.offlineQueue.length}</Text></Pressable></View><Surface style={styles.trackingCard}><View style={styles.radar}><View style={styles.radarRingOne} /><View style={styles.radarRingTwo} /><View style={styles.radarDot} /></View><View style={styles.trackingCopy}><StatusChip label={trackingState.label} tone={trackingState.tone} /><Text style={styles.trackingTitle}>{data.trackingActive ? "Your route is being captured." : "Route tracking starts after attendance check-in."}</Text><Text style={styles.trackingBody}>{trackingState.body}</Text></View></Surface><FieldButton disabled={isWorking} icon={data.trackingActive ? "stop-circle" : "play-circle-fill"} label={isWorking ? "Updating tracking…" : data.trackingActive ? "Stop route tracking" : "Enable route tracking"} onPress={data.trackingActive ? stopTracking : startTracking} variant={data.trackingActive ? "danger" : "primary"} /><View style={styles.metricGrid}><Surface style={styles.metric}><MaterialIcons color="#13C5B8" name="route" size={22} /><Text style={styles.metricValue}>{distance.toFixed(1)} km</Text><Text style={styles.metricLabel}>Recorded distance</Text></Surface><Surface style={styles.metric}><MaterialIcons color={online ? "#22B573" : "#D78B1C"} name={online ? "cloud-done" : "cloud-off"} size={22} /><Text style={styles.metricValue}>{online ? "Online" : "Offline"}</Text><Text style={styles.metricLabel}>{online ? "Internet reachable" : "Work remains queued"}</Text></Surface></View><SectionHeading title="Last known point" />{lastPoint ? <Surface style={styles.lastPoint}><View style={styles.pointIcon}><MaterialIcons color="#17354A" name="my-location" size={20} /></View><View style={{ flex: 1 }}><Text style={styles.pointText}>{lastPoint.latitude.toFixed(5)}, {lastPoint.longitude.toFixed(5)}</Text><Text style={styles.pointMeta}>Accuracy {lastPoint.accuracy !== null ? `±${Math.round(lastPoint.accuracy)} m` : "unknown"} · {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(lastPoint.capturedAt))}</Text></View><StatusChip label={lastPoint.mocked ? "Review signal" : "Device GPS"} tone={lastPoint.mocked ? "warning" : "success"} /></Surface> : <Surface style={styles.empty}><MaterialIcons color="#159FBE" name="location-searching" size={30} /><Text style={styles.emptyTitle}>No route points yet.</Text><Text style={styles.emptyBody}>Mark attendance to start route tracking automatically. You can also enable it here after granting location permission.</Text></Surface>}<Text style={styles.disclosure}>Sologix requests location after a successful attendance check-in and records it only when you grant device permission. Background tracking requires Android permission and shows its required ongoing system notification.</Text></ScrollView></ScreenContainer>;
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 18, paddingBottom: 32 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kicker: { color: "#0FA99F", fontSize: 10, letterSpacing: 1.3, fontWeight: "900", marginBottom: 5 },
  title: { color: "#17354A", fontSize: 27, fontWeight: "900", letterSpacing: -0.5 },
  subtitle: { color: "#7E96A9", fontSize: 13, marginTop: 4 },
  queueButton: { minWidth: 49, height: 43, borderRadius: 15, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EBF0", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  queueCount: { color: "#A96712", fontSize: 11, fontWeight: "900" },
  trackingCard: { minHeight: 190, overflow: "hidden", flexDirection: "row", alignItems: "center", gap: 15, backgroundColor: "#EAF9F8", borderColor: "#C6ECE8" },
  radar: { width: 88, height: 88, borderRadius: 44, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#AEE5DF", alignItems: "center", justifyContent: "center" },
  radarRingOne: { position: "absolute", width: 60, height: 60, borderRadius: 30, borderWidth: 1, borderColor: "rgba(19,197,184,0.32)" },
  radarRingTwo: { position: "absolute", width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: "rgba(19,197,184,0.5)" },
  radarDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#13C5B8", shadowColor: "#13C5B8", shadowOpacity: 0.5, shadowRadius: 10, elevation: 4 },
  trackingCopy: { flex: 1, gap: 8 },
  trackingTitle: { color: "#17354A", fontSize: 17, lineHeight: 22, fontWeight: "900" },
  trackingBody: { color: "#547087", fontSize: 12, lineHeight: 18 },
  metricGrid: { flexDirection: "row", gap: 10 },
  metric: { flex: 1, minHeight: 125, gap: 9 },
  metricValue: { color: "#17354A", fontSize: 19, fontWeight: "900", marginTop: 5 },
  metricLabel: { color: "#7E96A9", fontSize: 11, lineHeight: 15 },
  lastPoint: { flexDirection: "row", alignItems: "center", gap: 11 },
  pointIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#DDF8F5", justifyContent: "center", alignItems: "center" },
  pointText: { color: "#17354A", fontSize: 13, fontWeight: "800" },
  pointMeta: { color: "#7E96A9", fontSize: 11, marginTop: 4 },
  empty: { alignItems: "center", paddingVertical: 32, gap: 9 },
  emptyTitle: { color: "#17354A", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#7E96A9", fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 260 },
  disclosure: { color: "#7E96A9", fontSize: 11, lineHeight: 17, paddingHorizontal: 4 },
});
