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
import { trackingOutcomeMessage } from "@/lib/tracking-feedback";

export default function AttendanceCaptureScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ action?: "check-in" | "check-out" }>();
  const action = params.action === "check-out" ? "check-out" : "check-in";
  const { captureAttendance } = useFieldData();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [message, setMessage] = useState("Position your face inside the guide, then capture evidence.");

  const getVerifiedLocation = async (): Promise<LocationEvidence | null> => {
    const locationPermission = await Location.requestForegroundPermissionsAsync();
    if (locationPermission.status !== "granted") {
      Alert.alert("Location required", "Turn on precise location so this attendance record can be verified.");
      return null;
    }

    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      Alert.alert("Location unavailable", "Enable device location services, then try again.");
      return null;
    }

    if (Platform.OS === "android") {
      await Location.enableNetworkProviderAsync().catch(() => undefined);
    }

    setMessage("Verifying current GPS position…");
    const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, mayShowUserSettingsDialog: true });
    return {
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
      accuracy: result.coords.accuracy,
      capturedAt: new Date(result.timestamp).toISOString(),
      mocked: result.mocked,
    };
  };

  const capture = async () => {
    if (!cameraReady || !cameraRef.current) return;
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: false, skipProcessing: false });
      if (!photo?.uri) throw new Error("Camera did not return a usable photo.");
      const location = await getVerifiedLocation();
      if (!location) return;
      const outcome = await captureAttendance({ action, photoUri: photo.uri, location });
      Alert.alert(
        action === "check-in" ? "Check-in saved" : "Check-out saved",
        `${location.accuracy !== null && location.accuracy <= 60 ? "GPS evidence is verified. " : "GPS evidence has been marked for manager review due to low location accuracy. "}${trackingOutcomeMessage({ action, mode: outcome.tracking?.mode, reason: outcome.tracking?.reason, trackingStopped: outcome.trackingStopped })}`,
        [{ text: "Done", onPress: () => router.replace("/(tabs)") }],
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Evidence capture could not be completed. Please try again.");
    } finally {
      setIsCapturing(false);
    }
  };

  if (!permission) return <ScreenContainer containerClassName="bg-background" className="items-center justify-center"><ActivityIndicator color="#13C5B8" size="large" /></ScreenContainer>;

  if (!permission.granted) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background" className="p-5 justify-between">
        <View style={styles.permissionCard}>
          <View style={styles.permissionIcon}><MaterialIcons color="#17354A" name="camera-alt" size={28} /></View>
          <Text style={styles.permissionTitle}>Camera access keeps attendance accountable.</Text>
          <Text style={styles.permissionBody}>FieldPulse captures a current attendance photo alongside GPS evidence. The photo is stored locally first and uploaded only through the secure work connection.</Text>
        </View>
        <FieldButton icon="camera-alt" label="Allow camera access" onPress={requestPermission} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background" className="flex-1">
      <View style={styles.cameraWrap}>
        <CameraView facing={facing} onCameraReady={() => setCameraReady(true)} ref={cameraRef} style={StyleSheet.absoluteFill} />
        <View style={styles.gradientOverlay} />
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.iconButton}><MaterialIcons color="#F5F8FC" name="close" size={22} /></Pressable>
          <StatusChip label={action === "check-in" ? "CHECK-IN EVIDENCE" : "CHECK-OUT EVIDENCE"} tone="neutral" />
          <Pressable onPress={() => setFacing((current) => (current === "front" ? "back" : "front"))} style={styles.iconButton}><MaterialIcons color="#F5F8FC" name="flip-camera-android" size={21} /></Pressable>
        </View>
        <View style={styles.captureContent}>
          <View style={styles.guide}><View style={styles.cornerTopLeft} /><View style={styles.cornerTopRight} /><View style={styles.cornerBottomLeft} /><View style={styles.cornerBottomRight} /></View>
          <View style={styles.captureTextWrap}>
            <Text style={styles.captureTitle}>{action === "check-in" ? "Capture check-in proof" : "Capture check-out proof"}</Text>
            <Text style={styles.captureBody}>{message}</Text>
          </View>
          <Pressable disabled={!cameraReady || isCapturing} onPress={capture} style={({ pressed }) => [styles.captureButtonOuter, (!cameraReady || isCapturing) && styles.disabled, pressed && styles.pressed]}>
            <View style={styles.captureButtonInner}>{isCapturing ? <ActivityIndicator color="#071424" /> : <MaterialIcons color="#071424" name="camera" size={28} />}</View>
          </Pressable>
          <Text style={styles.privacyText}>A live GPS check starts only when you capture evidence.</Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  cameraWrap: { flex: 1, backgroundColor: "#071424" },
  gradientOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(7,20,36,0.28)" },
  topBar: { position: "absolute", top: 14, left: 18, right: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 42, height: 42, borderRadius: 14, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(7,20,36,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  captureContent: { flex: 1, alignItems: "center", justifyContent: "flex-end", padding: 24, paddingBottom: 30 },
  guide: { width: 230, height: 290, borderRadius: 110, borderWidth: 1, borderColor: "rgba(47,227,214,0.42)", backgroundColor: "rgba(7,20,36,0.13)", marginBottom: "auto", marginTop: 120, overflow: "hidden" },
  cornerTopLeft: { position: "absolute", top: 0, left: 0, width: 52, height: 52, borderTopWidth: 4, borderLeftWidth: 4, borderColor: "#2FE3D6", borderTopLeftRadius: 32 },
  cornerTopRight: { position: "absolute", top: 0, right: 0, width: 52, height: 52, borderTopWidth: 4, borderRightWidth: 4, borderColor: "#2FE3D6", borderTopRightRadius: 32 },
  cornerBottomLeft: { position: "absolute", bottom: 0, left: 0, width: 52, height: 52, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: "#2FE3D6", borderBottomLeftRadius: 32 },
  cornerBottomRight: { position: "absolute", bottom: 0, right: 0, width: 52, height: 52, borderBottomWidth: 4, borderRightWidth: 4, borderColor: "#2FE3D6", borderBottomRightRadius: 32 },
  captureTextWrap: { alignItems: "center", gap: 7, marginBottom: 22, backgroundColor: "rgba(7,20,36,0.72)", borderRadius: 18, padding: 14, maxWidth: 342 },
  captureTitle: { color: "#F5F8FC", fontWeight: "900", fontSize: 18 },
  captureBody: { color: "#D6E6F0", textAlign: "center", lineHeight: 18, fontSize: 12 },
  captureButtonOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: "rgba(234,244,248,0.8)", justifyContent: "center", alignItems: "center" },
  captureButtonInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: "#2FE3D6", alignItems: "center", justifyContent: "center" },
  privacyText: { color: "#EAF4F8", fontSize: 11, marginTop: 14, textShadowColor: "#071424", textShadowRadius: 4 },
  disabled: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.96 }] },
  permissionCard: { gap: 14, marginTop: 90 },
  permissionIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: "#DDF8F5", alignItems: "center", justifyContent: "center" },
  permissionTitle: { color: "#17354A", fontSize: 30, lineHeight: 36, fontWeight: "900", letterSpacing: -0.7 },
  permissionBody: { color: "#547087", fontSize: 15, lineHeight: 23 },
});
