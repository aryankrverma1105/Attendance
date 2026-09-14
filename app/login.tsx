import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { DepthOrb } from "@/components/depth-orb";
import { FieldButton, StatusChip } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useFieldData } from "@/lib/field-data";
import { trpc } from "@/lib/trpc";

export default function LoginScreen() {
  const router = useRouter();
  const { setServerSession } = useFieldData();
  const [identifier, setIdentifier] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [verificationStep, setVerificationStep] = useState<"request" | "verify">("request");
  const [verificationCode, setVerificationCode] = useState("");
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const activateMutation = trpc.auth.activate.useMutation();

  const formatPhoneNumber = (input: string): string => {
    let clean = input.trim();
    if (/^\d{10}$/.test(clean)) {
      return `+91${clean}`;
    }
    if (!clean.startsWith("+") && /^\d+$/.test(clean)) {
      return `+${clean}`;
    }
    return clean;
  };

  const requestAuthentication = async () => {
    let cleanPhone = formatPhoneNumber(identifier);
    if (!cleanPhone || cleanPhone.replace(/[^0-9]/g, "").length < 10) {
      setNotice("Please enter a valid 10-digit registered mobile number.");
      return;
    }
    setIdentifier(cleanPhone);
    setNotice(null);
    setIsRequesting(true);

    try {
      if (Platform.OS === "web") {
        try {
          const { requestWebPhoneOtp } = require("@/lib/firebase-web-auth");
          const confirmation = await requestWebPhoneOtp(cleanPhone);
          setConfirmResult(confirmation);
          setNotice(`Verification code sent to ${cleanPhone}.`);
          setVerificationStep("verify");
          return;
        } catch (webErr: any) {
          console.error("[Firebase Web Auth] Error:", webErr);
          const rawMsg = webErr?.message || "";
          if (rawMsg.includes("missing-initial-state") || rawMsg.includes("sessionStorage") || rawMsg.includes("storage-partitioned")) {
            setNotice("Browser blocked Firebase reCAPTCHA due to storage partitioning. Please test in Android APK or register your test phone in Firebase.");
          } else {
            setNotice(rawMsg || "Failed to send SMS code. Ensure Phone Auth is enabled in Firebase Console.");
          }
          return;
        }
      }

      // Native Android / iOS
      try {
        const rnfbAuth = require("@react-native-firebase/auth");
        let confirmation: any = null;

        if (typeof rnfbAuth.getAuth === "function" && typeof rnfbAuth.signInWithPhoneNumber === "function") {
          const auth = rnfbAuth.getAuth();
          confirmation = await rnfbAuth.signInWithPhoneNumber(auth, cleanPhone);
        } else {
          const authFn = typeof rnfbAuth === "function" ? rnfbAuth : (rnfbAuth.default || rnfbAuth);
          if (typeof authFn === "function") {
            confirmation = await authFn().signInWithPhoneNumber(cleanPhone);
          } else if (authFn && typeof authFn.signInWithPhoneNumber === "function") {
            confirmation = await authFn.signInWithPhoneNumber(cleanPhone);
          }
        }

        if (confirmation) {
          setConfirmResult(confirmation);
          setNotice(`Verification code sent to ${cleanPhone}.`);
          setVerificationStep("verify");
          return;
        } else {
          throw new Error("Could not initialize Firebase Phone Auth session.");
        }
      } catch (nativeErr: any) {
        console.error("[Firebase Auth] Native SMS error:", nativeErr);
        const nativeMsg = nativeErr?.message || "";
        setNotice(nativeMsg || "Failed to send SMS OTP via carrier.");
        return;
      }
    } catch (error) {
      console.error("[Auth] Failed to request OTP:", error);
      setNotice(error instanceof Error ? error.message : "Failed to send verification code.");
    } finally {
      setIsRequesting(false);
    }
  };

  const confirmCode = async () => {
    if (!verificationCode.trim() || verificationCode.length !== 6) {
      setNotice("Please enter a valid 6-digit verification code.");
      return;
    }

    setNotice(null);
    setIsVerifying(true);

    try {
      let idToken = "";

      if (confirmResult && typeof confirmResult.confirm === "function") {
        const userCredential = await confirmResult.confirm(verificationCode);
        idToken = await userCredential.user.getIdToken();
      } else {
        throw new Error("No active verification session. Please request a new SMS OTP.");
      }

      // Authoritative server-side activation
      const result = await activateMutation.mutateAsync({ idToken });

      if (result.success && result.user) {
        const { setSessionToken, setUserInfo } = require("@/lib/_core/auth");
        if (result.token) {
          await setSessionToken(result.token);
        }
        await setUserInfo(result.user);
        setServerSession(result.user, result.token);
        router.replace("/(tabs)");
        return;
      } else {
        throw new Error("Activation failed. Unable to authenticate session.");
      }
    } catch (error: any) {
      console.error("[Auth] Verification failed:", error);
      const msg = error?.message || "Verification failed. Please check the code and try again.";
      setNotice(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDevQuickLogin = async () => {
    let cleanPhone = formatPhoneNumber(identifier);
    if (!cleanPhone || cleanPhone.replace(/[^0-9]/g, "").length < 10) {
      setNotice("Please enter a valid 10-digit mobile number for dev preview.");
      return;
    }
    setIdentifier(cleanPhone);
    setNotice(null);
    setIsVerifying(true);

    try {
      const idToken = `mock_token_phone_${cleanPhone}`;
      const result = await activateMutation.mutateAsync({ idToken });

      if (result.success && result.user) {
        const { setSessionToken, setUserInfo } = require("@/lib/_core/auth");
        if (result.token) {
          await setSessionToken(result.token);
        }
        await setUserInfo(result.user);
        setServerSession(result.user, result.token);
        router.replace("/(tabs)");
      } else {
        throw new Error("Dev login failed. User not registered or server rejected token.");
      }
    } catch (err: any) {
      console.error("[Auth] Dev login error:", err);
      setNotice(err?.message || "Dev login failed. Server rejected token.");
    } finally {
      setIsVerifying(false);
    }
  };

  const isDevMode = typeof __DEV__ !== "undefined" && __DEV__;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background" className="px-5">
      <LinearGradient colors={["#EAF9F8", "#F6FCFD", "#EFF6FA"]} style={StyleSheet.absoluteFillObject} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.topArea}>
            <View style={styles.brandRow}>
              <Image resizeMode="contain" source={require("@/assets/images/sologix-logo.png")} style={styles.sologixLogo} />
            </View>
            <DepthOrb />
            <View style={styles.heroCopy}>
              <StatusChip label="Sologix Energy field operations" tone="success" />
              <Text style={styles.title}>Energizing every field shift with verified proof.</Text>
              <Text style={styles.subtitle}>
                Sologix Energy Pvt Ltd uses this secure workspace for attendance, customer visits, and field workforce management.
              </Text>
            </View>
          </View>

          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Sign in</Text>
            <Text style={styles.sheetSubtitle}>
              {verificationStep === "request"
                ? "Enter your registered mobile number to receive a secure one-time code."
                : `Enter the 6-digit code sent to ${identifier}`}
            </Text>

            {verificationStep === "request" ? (
              <>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="tel"
                  keyboardType="phone-pad"
                  onChangeText={setIdentifier}
                  placeholder="e.g. 9835916278"
                  placeholderTextColor="#74899A"
                  style={styles.input}
                  value={identifier}
                />
              </>
            ) : (
              <>
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={setVerificationCode}
                  placeholder="6-digit verification code"
                  placeholderTextColor="#74899A"
                  style={styles.input}
                  value={verificationCode}
                  maxLength={6}
                />
                <Pressable
                  onPress={() => {
                    setVerificationStep("request");
                    setVerificationCode("");
                    setNotice(null);
                  }}
                  style={{ paddingVertical: 8, marginBottom: 4 }}
                >
                  <Text style={{ color: "#13C5B8", fontWeight: "600" }}>← Use a different number</Text>
                </Pressable>
              </>
            )}

            {notice ? (
              <Text
                style={[
                  styles.notice,
                  notice.toLowerCase().includes("sent") && { color: "#0D9488" },
                ]}
              >
                {notice}
              </Text>
            ) : null}

            {verificationStep === "request" ? (
              <>
                <FieldButton
                  icon="lock-outline"
                  label="Request secure SMS code"
                  onPress={requestAuthentication}
                  style={styles.action}
                  loading={isRequesting || activateMutation.isPending}
                />

                {isDevMode ? (
                  <Pressable
                    onPress={handleDevQuickLogin}
                    style={styles.devButton}
                  >
                    <MaterialIcons name="developer-mode" size={16} color="#0D9488" />
                    <Text style={styles.devButtonText}>Dev Quick Login (Testing Only)</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <FieldButton
                icon="verified-user"
                label="Verify secure code"
                onPress={confirmCode}
                style={styles.action}
                loading={isVerifying || activateMutation.isPending}
              />
            )}

            <Text style={styles.footnote}>Sologix Energy Pvt Ltd · Authorized Personnel Only</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingBottom: 20,
  },
  topArea: { paddingTop: 6, paddingBottom: 12 },
  brandRow: { height: 80, alignItems: "flex-start", justifyContent: "center", marginBottom: 8 },
  sologixLogo: { width: 80, height: 80, borderRadius: 12 },
  heroCopy: { gap: 8, marginTop: 2 },
  title: { color: "#17354A", fontSize: 26, lineHeight: 32, letterSpacing: -0.8, fontWeight: "900", maxWidth: 340 },
  subtitle: { color: "#547087", fontSize: 14, lineHeight: 20, maxWidth: 350 },
  sheet: {
    backgroundColor: "rgba(255,255,255,0.98)",
    marginHorizontal: -20,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 24,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#E0EBF0",
    shadowColor: "#0F2837",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 16,
    elevation: 8,
  },
  sheetTitle: { color: "#17354A", fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
  sheetSubtitle: { color: "#7E96A9", fontSize: 13, lineHeight: 18, marginBottom: 2 },
  input: { minHeight: 50, borderRadius: 14, backgroundColor: "#F8FBFC", color: "#17354A", fontSize: 15, paddingHorizontal: 15, borderWidth: 1, borderColor: "#DDEAF0" },
  notice: { color: "#DC2626", fontSize: 13, lineHeight: 18, paddingHorizontal: 2, fontWeight: "600" },
  action: { marginTop: 4 },
  devButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F0FDFA",
    borderWidth: 1,
    borderColor: "#CCFBF1",
    gap: 6,
    marginTop: 4,
  },
  devButtonText: {
    color: "#0F766E",
    fontSize: 13,
    fontWeight: "700",
  },
  footnote: { color: "#7E96A9", fontSize: 11, lineHeight: 16, textAlign: "center", paddingHorizontal: 8, marginTop: 4 },
});
