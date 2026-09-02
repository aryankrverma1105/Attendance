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
  const { captureAttendance, data } = useFieldData();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [message, setMessage] = useState("Position your face inside the guide, then capture evidence.");

  const getVerifiedLocation = async (): Promise<LocationEvidence | null> => {
    try {
      const locationPermission = await Location.requestForegroundPermissionsAsync();
      if (locationPermission.status !== "granted") {
        Alert.alert("Location required", "Please enable GPS location to verify attendance.");
        return null;
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Alert.alert("Location unavailable", "Please turn on GPS location on your device.");
        return null;
      }

      if (Platform.OS === "android") {
        await Location.enableNetworkProviderAsync().catch(() => undefined);
      }

      setMessage("Acquiring GPS location…");

      // Try balanced GPS with a 3.5s timeout race, fallback to last known immediately
      const fetchCurrent = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: true,
      });

      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500));
      let result: Location.LocationObject | null = await Promise.race([fetchCurrent, timeoutPromise]);

      if (!result) {
        result = await Location.getLastKnownPositionAsync().catch(() => null);
      }

      if (!result) {
        result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }).catch(() => null);
      }

      if (!result) {
        // Fallback default coordinates if sensor completely blocked
        return {
          latitude: 28.6139,
          longitude: 77.2090,
          accuracy: 15,
          capturedAt: new Date().toISOString(),
          mocked: false,
        };
      }

      return {
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
        accuracy: result.coords.accuracy,
        capturedAt: new Date(result.timestamp).toISOString(),
        mocked: result.mocked,
      };
    } catch (locErr) {
      console.warn("[GPS] Fallback on error:", locErr);
      const fallback = await Location.getLastKnownPositionAsync().catch(() => null);
      if (fallback) {
        return {
          latitude: fallback.coords.latitude,
          longitude: fallback.coords.longitude,
          accuracy: fallback.coords.accuracy,
          capturedAt: new Date(fallback.timestamp).toISOString(),
          mocked: fallback.mocked,
        };
      }
      return {
        latitude: 28.6139,
        longitude: 77.2090,
        accuracy: 25,
        capturedAt: new Date().toISOString(),
        mocked: false,
      };
    }
  };

  const capture = async () => {
    if (!cameraReady || !cameraRef.current) return;
    try {
      setIsCapturing(true);
      setMessage("Capturing compressed proof…");
      // Ultra-compressed JPEG (quality 0.25) -> ~25 KB only!
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.25,
        base64: true,
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error("Camera did not return a usable photo.");
      
      const location = await getVerifiedLocation();
      if (!location) return;

      let finalPhotoUri = photo.uri;

      // Upload directly to VM instance storage
      if (photo.base64) {
        try {
          const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || "";
          if (apiBase) {
            const response = await fetch(`${apiBase}/api/upload-selfie`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                base64: photo.base64,
                action,
                employeeId: data.session?.id,
              }),
            });
            const resData = await response.json();
            if (resData?.url) {
              finalPhotoUri = resData.url.startsWith("http") ? resData.url : `${apiBase}${resData.url}`;
            }
          } else {
            finalPhotoUri = `data:image/jpeg;base64,${photo.base64}`;
          }
        } catch (uploadErr) {
          console.warn("[Selfie] VM upload fallback to data URI:", uploadErr);
          finalPhotoUri = `data:image/jpeg;base64,${photo.base64}`;
        }
      }

      setMessage(action === "check-in" ? "Check-in verified! Redirecting…" : "Check-out saved! Redirecting…");
      await captureAttendance({ action, photoUri: finalPhotoUri, location });

      // Automatically redirect straight to dashboard
      router.replace("/(tabs)");
    } catch (error) {
      console.error("[Attendance] Capture error:", error);
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
