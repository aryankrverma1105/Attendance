import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBpYt8JvAiZ5_lVolhpmpqXkPBsFAJ7y3M",
  authDomain: "aquasense-477908.firebaseapp.com",
  projectId: "aquasense-477908",
  storageBucket: "aquasense-477908.firebasestorage.app",
  messagingSenderId: "183614360333",
  appId: "1:183614360333:web:de09841bb849e1ac063e44",
};

let cachedAuth: ReturnType<typeof getAuth> | null = null;

export function getWebFirebaseAuth() {
  if (typeof window === "undefined") return null;
  if (cachedAuth) return cachedAuth;

  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  try {
    cachedAuth = getAuth(app);
  } catch {
    try {
      cachedAuth = initializeAuth(app);
    } catch {
      cachedAuth = getAuth(app);
    }
  }
  return cachedAuth;
}

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
    grecaptcha?: any;
  }
}

export async function requestWebPhoneOtp(phoneNumber: string): Promise<ConfirmationResult> {
  const auth = getWebFirebaseAuth();
  if (!auth || typeof window === "undefined") {
    throw new Error("Web Firebase Auth is only available in browser environments.");
  }

  // Ensure recaptcha-container element exists in DOM
  let container = document.getElementById("recaptcha-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "recaptcha-container";
    document.body.appendChild(container);
  }

  // Reset existing verifier if expired
  if (window.recaptchaVerifier) {
    try {
      window.recaptchaVerifier.clear();
    } catch {}
    window.recaptchaVerifier = undefined;
  }

  window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
    size: "invisible",
    callback: () => {
      // reCAPTCHA solved
    },
    "expired-callback": () => {
      if (window.recaptchaVerifier) {
        try {
          window.recaptchaVerifier.clear();
        } catch {}
        window.recaptchaVerifier = undefined;
      }
    },
  });

  return await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
}
