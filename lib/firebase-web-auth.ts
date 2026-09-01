import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
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

export function getWebFirebaseAuth() {
  if (typeof window === "undefined") return null;
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  return getAuth(app);
}

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
    recaptchaWidgetId?: any;
  }
}

export async function requestWebPhoneOtp(phoneNumber: string): Promise<ConfirmationResult> {
  const auth = getWebFirebaseAuth();
  if (!auth || typeof window === "undefined") {
    throw new Error("Web Firebase Auth is only available in browser environments.");
  }

  // Ensure a DOM container exists for invisible reCAPTCHA
  let container = document.getElementById("recaptcha-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "recaptcha-container";
    document.body.appendChild(container);
  }

  if (!window.recaptchaVerifier) {
    window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
      size: "invisible",
      callback: () => {
        // reCAPTCHA solved - allow signInWithPhoneNumber
      },
      "expired-callback": () => {
        if (window.recaptchaVerifier) {
          window.recaptchaVerifier.clear();
          window.recaptchaVerifier = undefined;
        }
      },
    });
  }

  return await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
}
