import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth";

export const firebaseWebConfig = {
  apiKey: "AIzaSyBpYt8JvAiZ5_lVolhpmpqXkPBsFAJ7y3M",
  authDomain: "aquasense-477908.firebaseapp.com",
  projectId: "aquasense-477908",
  storageBucket: "aquasense-477908.firebasestorage.app",
  messagingSenderId: "183614360333",
  appId: "1:183614360333:web:29a24ad2ebfdfe80063e44",
};

export function getWebAuthInstance() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseWebConfig);
  return getAuth(app);
}

export async function requestWebPhoneOtp(
  phoneNumber: string,
  containerId: string = "recaptcha-container"
): Promise<ConfirmationResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Web phone OTP requires browser environment.");
  }

  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    document.body.appendChild(container);
  }

  const auth = getWebAuthInstance();

  if ((window as any).recaptchaVerifier) {
    try {
      (window as any).recaptchaVerifier.clear();
    } catch {}
  }

  const verifier = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
  });
  (window as any).recaptchaVerifier = verifier;

  return await signInWithPhoneNumber(auth, phoneNumber, verifier);
}
