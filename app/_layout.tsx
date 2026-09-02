import "@/global.css";
import "react-native-reanimated";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, type AppStateStatus, Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { FieldDataProvider, useFieldData } from "@/lib/field-data";
import { ThemeProvider } from "@/lib/theme-provider";
import { trpc, createTRPCClient } from "@/lib/trpc";
import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import "@/lib/location-tracking";
import "@/lib/_core/nativewind-pressable";
import { getSessionRedirect } from "@/lib/session-routing";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const unstable_settings = { anchor: "(tabs)" };

function SessionGate({ children }: { children: ReactNode }) {
  const { data, isHydrated, signOut } = useFieldData();
  const router = useRouter();
  const segments = useSegments();
  const onLoginScreen = segments[0] === "login";
  const lastActiveRef = useRef<number>(Date.now());

  const updateActivity = useCallback(() => {
    lastActiveRef.current = Date.now();
  }, []);

  // 1. Session Redirect Gate
  useEffect(() => {
    if (!isHydrated) return;
    const redirect = getSessionRedirect({ hasSession: Boolean(data.session), onLoginScreen });
    if (redirect) router.replace(redirect);
  }, [data.session, isHydrated, onLoginScreen, router]);

  // 2. 30-Minute Inactivity & Background Sleep Auto-Logout
  useEffect(() => {
    if (!data.session) return;

    lastActiveRef.current = Date.now();

    // Periodic inactivity interval check (every 15s)
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActiveRef.current;
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        console.log("[Auth] Logging out user after 30 minutes of inactivity.");
        signOut();
      }
    }, 15000);

    // AppState change listener (handles background / app resume)
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") {
        const elapsed = Date.now() - lastActiveRef.current;
        if (elapsed >= INACTIVITY_TIMEOUT_MS) {
          console.log("[Auth] Session expired during background sleep. Logging out.");
          signOut();
        } else {
          lastActiveRef.current = Date.now();
        }
      } else if (nextState === "background" || nextState === "inactive") {
        lastActiveRef.current = Date.now();
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [data.session, signOut]);

  if (!isHydrated) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color="#2FE3D6" size="large" />
        <Text style={styles.loadingText}>Preparing your secure workspace</Text>
      </View>
    );
  }

  return (
    <View onTouchStart={updateActivity} style={{ flex: 1 }}>
      {children}
    </View>
  );
}

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;
  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  useEffect(() => {
    initManusRuntime();
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    return subscribeSafeAreaInsets(handleSafeAreaUpdate);
  }, [handleSafeAreaUpdate]);

  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return { ...metrics, insets: { ...metrics.insets, top: Math.max(metrics.insets.top, 16), bottom: Math.max(metrics.insets.bottom, 12) } };
  }, [initialFrame, initialInsets]);

  const navigator = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <FieldDataProvider>
            <SessionGate>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="login" options={{ animation: "fade", presentation: "fullScreenModal" }} />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="attendance" options={{ animation: "slide_from_bottom" }} />
                <Stack.Screen name="customers" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="visit-plan" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="visit-detail" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="visit-evidence" options={{ animation: "slide_from_bottom" }} />
                <Stack.Screen name="history" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="chat" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="offline-queue" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="admin-dashboard" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="employee-detail" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="earnings" options={{ animation: "slide_from_right" }} />
              </Stack>
              <StatusBar style="dark" />
            </SessionGate>
          </FieldDataProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  if (Platform.OS === "web") {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>{navigator}</SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return <ThemeProvider><SafeAreaProvider initialMetrics={providerInitialMetrics}>{navigator}</SafeAreaProvider></ThemeProvider>;
}

const styles = StyleSheet.create({
  loadingScreen: { flex: 1, backgroundColor: "#F3F8FA", alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { color: "#547087", fontSize: 15, fontWeight: "600" },
});
