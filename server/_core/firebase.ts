import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { ENV } from "./env";
import fs from "fs";
import path from "path";

let initialized = false;

export function getFirebaseAdmin() {
  if (initialized || getApps().length > 0) {
    initialized = true;
    return true;
  }

  const credentialPath = ENV.firebaseServiceAccount;
  if (!credentialPath) {
    console.warn("[Firebase] FIREBASE_SERVICE_ACCOUNT is not configured. Real token verification will be unavailable.");
    return false;
  }

  try {
    const resolvedPath = path.resolve(process.cwd(), credentialPath);
    if (!fs.existsSync(resolvedPath)) {
      console.warn(`[Firebase] Service account file not found at ${resolvedPath}. Real token verification will be unavailable.`);
      return false;
    }

    const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    initializeApp({
      credential: cert(serviceAccount),
    });
    initialized = true;
    console.log("[Firebase] Firebase Admin SDK initialized successfully.");
    return true;
  } catch (error) {
    console.error("[Firebase] Failed to initialize Firebase Admin SDK:", error);
    return false;
  }
}

export async function verifyFirebaseToken(idToken: string) {
  // Mock token code path: strictly dev/preview-only fallback.
  // In production, mock tokens are rejected and real Firebase ID tokens must be verified.
  if (idToken.startsWith("mock_token_")) {
    if (ENV.isProduction) {
      throw new Error("Mock authentication tokens are strictly forbidden in production");
    }

    const raw = idToken.replace("mock_token_phone_", "").replace("mock_token_uid_", "");
    const phone = decodeURIComponent(raw);
    const digits = phone.replace(/[^0-9]/g, "");
    if (!digits || digits.length < 10) {
      throw new Error("Mock token requires an explicit, valid phone number");
    }

    const phoneE164 = phone.startsWith("+") ? phone : `+${digits}`;
    return {
      uid: `dev_${digits}`,
      phone_number: phoneE164,
    };
  }

  const isInitialized = getFirebaseAdmin();
  if (!isInitialized) {
    throw new Error("Firebase Admin SDK is not initialized and token is not a mock token.");
  }

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error("[Firebase] ID Token verification failed:", error);
    throw error;
  }
}
