import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { DepthOrb } from "@/components/depth-orb";
import { FieldButton, StatusChip } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useFieldData } from "@/lib/field-data";
import { getApiBaseUrl } from "@/constants/oauth";
import { trpc, trpcClient } from "@/lib/trpc";
import { resumeQueue } from "@/lib/offline-sync";

export default function LoginScreen() {
  const router = useRouter();
  const { setServerSession } = useFieldData();
  const [identifier, setIdentifier] = useState("");
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [verificationStep, setVerificationStep] = useState<"request" | "verify">("request");
  const [verificationCode, setVerificationCode] = useState("");
  const [confirmResult, setConfirmResult] = useState<any>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const activateMutation = trpc.auth.activate.useMutation();

  const handlePostLogin = async (token: string, user: any) => {
    const { setSessionToken, setUserInfo } = require("@/lib/_core/auth");
    await setSessionToken(token);
    if (user) {
      await setUserInfo(user);
      setServerSession(user);
    }
    resumeQueue();

    if (Platform.OS !== "web") {
      try {
        const { registerForPushNotificationsAsync } = await import("@/lib/push-notifications");
        const pushToken = await registerForPushNotificationsAsync();
        if (pushToken) {
          await trpcClient.notifications.registerDevice.mutate({ expoPushToken: pushToken }).catch((err) => {
            console.warn("[Push] Failed to register device push token:", err);
          });
        }
      } catch (pushErr) {
        console.warn("[Push] Non-fatal push registration error:", pushErr);
      }
    }
  };

  const requestAuthentication = async () => {
    let cleanPhone = identifier.trim();
    if (!cleanPhone) {
      setNotice("Enter your registered mobile number or administrator identifier.");
      return;
    }

    // Auto-format Indian numbers to E.164 if entered without +91
    if (/^\d{10}$/.test(cleanPhone)) {
      cleanPhone = `+91${cleanPhone}`;
      setIdentifier(cleanPhone);
    } else if (!cleanPhone.startsWith("+") && /^\d+$/.test(cleanPhone)) {
      cleanPhone = `+${cleanPhone}`;
      setIdentifier(cleanPhone);
    }
    
    setNotice(null);
    setIsRequesting(true);

    if (mode === "password") {
      if (!password.trim()) {
        setNotice("Please enter your password.");
        setIsRequesting(false);
        return;
      }

      try {
        const apiBase = getApiBaseUrl();
        if (!apiBase) {
          setNotice("API service unavailable. Please check your network connection.");
          setIsRequesting(false);
          return;
        }

        const res = await fetch(`${apiBase}/api/auth/password-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: cleanPhone, password }),
        });

        const loginData = await res.json().catch(() => null);

        if (!res.ok || !loginData?.success || !loginData?.token) {
          setNotice(loginData?.error ?? loginData?.message ?? "Invalid credentials or account inactive.");
          setIsRequesting(false);
          return;
        }

        await handlePostLogin(loginData.token, loginData.user);
        router.replace("/(tabs)");
        return;
      } catch (err: any) {
        setNotice(err?.message || "Failed to reach server. Please check your network connection.");
        return;
      } finally {
        setIsRequesting(false);
      }
    }

    // OTP Mode: Firebase Phone SMS verification handles carrier OTP delivery for any phone number
    try {
      let isNativeAuthAvailable = false;
      let firebaseAuthModule: any = null;

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
            setNotice(
              "Browser blocked Firebase reCAPTCHA due to Storage Partitioning. " +
              "Please switch to 'Password Mode' above (no SMS/reCAPTCHA required), " +
              "or add your test phone number in Firebase Console."
            );
          } else if (rawMsg.includes("internal-error")) {
            setNotice("Firebase Web App is not yet registered in Firebase Console for this project. Please switch to Password mode on PC, or test on Android APK.");
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
        if (nativeMsg.includes("missing-initial-state") || nativeMsg.includes("sessionStorage") || nativeMsg.includes("storage-partitioned")) {
          setNotice(
            "Android browser blocked reCAPTCHA redirect. " +
            "Please register the Android SHA-1 in Firebase Console, or log in instantly using 'Password Mode' above."
          );
        } else {
          setNotice(nativeMsg || "Failed to send SMS OTP via carrier.");
        }
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

      // Send token to backend to activate / sign-in
      const result = await activateMutation.mutateAsync({ idToken });

      if (result?.success && result?.user && result?.token) {
        await handlePostLogin(result.token, result.user);
        router.replace("/(tabs)");
        return;
      } else {
        setNotice("Account activation failed. Please contact your administrator.");
      }
    } catch (error) {
      console.error("[Auth] Verification failed:", error);
      setNotice(error instanceof Error ? error.message : "Verification failed.");
    } finally {
      setIsVerifying(false);
    }
  };

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
                ? "Use your registered mobile number or work email."
                : `Enter the code sent to ${identifier}`}
            </Text>

            {verificationStep === "request" ? (
              <>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={setIdentifier}
                  placeholder="Registered mobile number"
                  placeholderTextColor="#74899A"
                  style={styles.input}
                  value={identifier}
                />
                <View style={styles.modeRow}>
                  <Pressable onPress={() => setMode("password")} style={[styles.modeButton, mode === "password" && styles.modeButtonActive]}>
                    <Text style={[styles.modeText, mode === "password" && styles.modeTextActive]}>Password</Text>
                  </Pressable>
                  <Pressable onPress={() => setMode("otp")} style={[styles.modeButton, mode === "otp" && styles.modeButtonActive]}>
                    <Text style={[styles.modeText, mode === "otp" && styles.modeTextActive]}>One-time code</Text>
                  </Pressable>
                </View>
                {mode === "password" ? (
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setPassword}
                    placeholder="Password"
                    placeholderTextColor="#74899A"
                    secureTextEntry
                    style={styles.input}
                    value={password}
                  />
                ) : null}
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
              <FieldButton
                icon={mode === "password" ? "vpn-key" : "lock-outline"}
                label={mode === "password" ? "Continue securely" : "Request secure code"}
                onPress={requestAuthentication}
                style={styles.action}
                loading={isRequesting || activateMutation.isPending}
              />
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
    gap: 10,
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
  modeRow: { padding: 4, backgroundColor: "#EFF6F8", borderRadius: 12, flexDirection: "row" },
  modeButton: { flex: 1, minHeight: 36, justifyContent: "center", alignItems: "center", borderRadius: 10 },
  modeButtonActive: { backgroundColor: "#FFFFFF", shadowColor: "#527085", shadowOpacity: 0.09, shadowOffset: { width: 0, height: 3 }, shadowRadius: 7, elevation: 2 },
  modeText: { color: "#7E96A9", fontWeight: "700", fontSize: 13 },
  modeTextActive: { color: "#17354A" },
  notice: { color: "#DC2626", fontSize: 13, lineHeight: 18, paddingHorizontal: 2, fontWeight: "600" },
  action: { marginTop: 4 },
  footnote: { color: "#7E96A9", fontSize: 11, lineHeight: 16, textAlign: "center", paddingHorizontal: 8, marginTop: 4 },
});
