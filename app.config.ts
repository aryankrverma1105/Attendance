import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

const rawBundleId = "space.manus.field.attendance";
const bundleId = rawBundleId.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();

const env = {
  appName: "Sologix Energy Attendance",
  appSlug: "field-attendance",
  logoUrl: "/manus-storage/sologix-energy-icon_c17799ae.png",
  scheme: "fieldpulse",
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "light",
  newArchEnabled: true,
  extra: {
    companyName: "Sologix Energy Pvt Ltd",
    developerName: "Aryan Kumar Verma",
    brandTagline: "Energizing Naturally",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: env.iosBundleId,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#FFFFFF",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    googleServicesFile: "./google-services.json",
    package: env.androidPackage,
    permissions: [
      "POST_NOTIFICATIONS",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
    ],
  },
  web: { bundler: "metro", output: "static", favicon: "./assets/images/favicon.png" },
  plugins: [
    "expo-router",
    ["expo-camera", { cameraPermission: "Allow $(PRODUCT_NAME) to capture attendance and visit evidence." }],
    [
      "expo-location",
      {
        locationWhenInUsePermission: "Allow $(PRODUCT_NAME) to verify attendance and customer visits.",
        locationAlwaysAndWhenInUsePermission: "Allow $(PRODUCT_NAME) to track approved field routes while tracking is active.",
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ["expo-secure-store", { configureAndroidBackup: true, faceIDPermission: "Allow $(PRODUCT_NAME) to protect your workspace with biometrics." }],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#FFFFFF",
      },
    ],
    ["expo-build-properties", { android: { buildArchs: ["armeabi-v7a", "arm64-v8a"], minSdkVersion: 24 } }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
