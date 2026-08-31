import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, StatusChip } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useFieldData } from "@/lib/field-data";
import type { LocationEvidence } from "@/lib/field-types";

export default function VisitEvidenceScreen() {
  const router = useRouter();
  const { id, action } = useLocalSearchParams<{ id: string; action?: "check-in" | "check-out" }>();
  const mode = action === "check-out" ? "check-out" : "check-in";
  const { captureVisitEvidence } = useFieldData();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const getLocation = async (): Promise<LocationEvidence | null> => {
    const permissionResult = await Location.requestForegroundPermissionsAsync();
    if (permissionResult.status !== "granted") {
      Alert.alert("Location required", "GPS evidence is required to verify this customer visit.");
      return null;
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      Alert.alert("Enable location", "Turn on device location services and try again.");
      return null;
    }
    if (Platform.OS === "android") await Location.enableNetworkProviderAsync().catch(() => undefined);
    const value = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, mayShowUserSettingsDialog: true });
    return { latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy, capturedAt: new Date(value.timestamp).toISOString(), mocked: value.mocked };
  };

  const capture = async () => {
    if (!cameraRef.current || !ready) return;
    try {
      setCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: false, skipProcessing: false });
      if (!photo?.uri) throw new Error("A usable photo could not be captured.");
      const location = await getLocation();
      if (!location) return;
      captureVisitEvidence({ visitId: id, action: mode, photoUri: photo.uri, location });
      Alert.alert(mode === "check-in" ? "Customer check-in saved" : "Customer check-out saved", "Your photo and GPS evidence were saved locally and added to the secure sync queue.", [{ text: "Continue", onPress: () => router.replace({ pathname: "/visit-detail", params: { id } }) }]);
    } catch (error) {
      Alert.alert("Evidence capture failed", error instanceof Error ? error.message : "Try again with a strong GPS signal.");
    } finally {
      setCapturing(false);
    }
  };

  if (!permission) return <ScreenContainer containerClassName="bg-background" className="items-center justify-center"><ActivityIndicator color="#2FE3D6" /></ScreenContainer>;
  if (!permission.granted) return <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background" className="p-5 justify-between"><View style={styles.permission}><View style={styles.permissionIcon}><MaterialIcons color="#071424" name="camera-alt" size={28} /></View><Text style={styles.permissionTitle}>Capture visit evidence.</Text><Text style={styles.permissionBody}>A visit photo and a fresh GPS coordinate protect your customer activity record.</Text></View><FieldButton icon="camera-alt" label="Allow camera access" onPress={requestPermission} /></ScreenContainer>;

  return <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background" className="flex-1"><View style={styles.cameraWrap}><CameraView facing="back" onCameraReady={() => setReady(true)} ref={cameraRef} style={StyleSheet.absoluteFill} /><View style={styles.overlay} /><View style={styles.top}><Pressable onPress={() => router.back()} style={styles.topButton}><MaterialIcons color="#F5F8FC" name="close" size={22} /></Pressable><StatusChip label={mode === "check-in" ? "CUSTOMER CHECK-IN" : "CUSTOMER CHECK-OUT"} tone="neutral" /></View><View style={styles.bottom}><View style={styles.proofCard}><Text style={styles.proofTitle}>{mode === "check-in" ? "Show the customer site" : "Close the customer visit"}</Text><Text style={styles.proofBody}>Capture a clear site image. FieldPulse will pair it with a fresh GPS fix and server timestamp at synchronization.</Text></View><Pressable disabled={!ready || capturing} onPress={capture} style={({ pressed }) => [styles.capture, (!ready || capturing) && styles.disabled, pressed && styles.pressed]}><View style={styles.captureInner}>{capturing ? <ActivityIndicator color="#071424" /> : <MaterialIcons color="#071424" name="camera" size={27} />}</View></Pressable><Text style={styles.note}>GPS activates only when you capture this visit proof.</Text></View></View></ScreenContainer>;
}

const styles = StyleSheet.create({
  cameraWrap: { flex: 1, backgroundColor: "#071424" },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(7,20,36,0.25)" },
  top: { position: "absolute", top: 14, left: 18, right: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  topButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(7,20,36,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", justifyContent: "center", alignItems: "center" },
  bottom: { flex: 1, alignItems: "center", justifyContent: "flex-end", padding: 24, paddingBottom: 30 },
  proofCard: { backgroundColor: "rgba(7,20,36,0.75)", padding: 14, borderRadius: 18, gap: 5, marginBottom: 22, maxWidth: 340 },
  proofTitle: { color: "#F5F8FC", fontSize: 17, fontWeight: "900", textAlign: "center" },
  proofBody: { color: "#D6E6F0", fontSize: 12, lineHeight: 18, textAlign: "center" },
  capture: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: "rgba(234,244,248,0.8)", alignItems: "center", justifyContent: "center" },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: "#2FE3D6", alignItems: "center", justifyContent: "center" },
  note: { color: "#EAF4F8", fontSize: 11, marginTop: 14, textShadowColor: "#071424", textShadowRadius: 4 },
  permission: { marginTop: 90, gap: 14 },
  permissionIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: "#2FE3D6", justifyContent: "center", alignItems: "center" },
  permissionTitle: { color: "#F5F8FC", fontSize: 30, lineHeight: 36, fontWeight: "900", letterSpacing: -0.7 },
  permissionBody: { color: "#BED0DF", fontSize: 15, lineHeight: 23 },
  disabled: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.96 }] },
});
