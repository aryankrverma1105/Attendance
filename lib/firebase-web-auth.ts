const firebaseConfig = {
  apiKey: "AIzaSyBpYt8JvAiZ5_lVolhpmpqXkPBsFAJ7y3M",
  authDomain: "aquasense-477908.firebaseapp.com",
  projectId: "aquasense-477908",
  storageBucket: "aquasense-477908.firebasestorage.app",
  messagingSenderId: "183614360333",
  appId: "1:183614360333:web:de09841bb849e1ac063e44",
};

/**
 * Loads the official Firebase Web SDK dynamically into the browser to guarantee
 * 100% reliable initialization without Metro / React-Native package bundling conflicts.
 */
export async function loadFirebaseWebSDK(): Promise<any> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Firebase Web SDK is only supported in browser environments.");
  }

  const win = window as any;

  if (!win.firebase) {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector('script[src*="firebase-app-compat.js"]');
      if (existing) {
        existing.addEventListener("load", () => resolve());
        return;
      }
      const script = document.createElement("script");
      script.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Firebase App library from Google CDN."));
      document.head.appendChild(script);
    });
  }

  if (!win.firebase?.auth) {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector('script[src*="firebase-auth-compat.js"]');
      if (existing) {
        existing.addEventListener("load", () => resolve());
        return;
      }
      const script = document.createElement("script");
      script.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Firebase Auth library from Google CDN."));
      document.head.appendChild(script);
    });
  }

  const fb = (window as any).firebase;
  if (fb && (!fb.apps || fb.apps.length === 0)) {
    fb.initializeApp(firebaseConfig);
  }

  return fb;
}

export async function requestWebPhoneOtp(phoneNumber: string): Promise<any> {
  const firebase = await loadFirebaseWebSDK();
  if (!firebase || !firebase.auth) {
    throw new Error("Firebase Authentication could not be loaded in this browser.");
  }

  // Set persistence to LOCAL so session state is stored in localStorage instead of volatile/partitioned sessionStorage
  try {
    if (firebase.auth.Auth?.Persistence?.LOCAL) {
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    }
  } catch (persistErr) {
    console.warn("[Firebase Web Auth] Could not set LOCAL persistence:", persistErr);
  }

  // Ensure DOM anchor element exists for reCAPTCHA
  let container = document.getElementById("recaptcha-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "recaptcha-container";
    container.style.marginTop = "8px";
    document.body.appendChild(container);
  }

  const win = window as any;

  if (win.recaptchaVerifier) {
    try {
      win.recaptchaVerifier.clear();
    } catch {}
    win.recaptchaVerifier = undefined;
  }

  try {
    win.recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", {
      size: "invisible",
      callback: () => {
        // reCAPTCHA verified successfully
      },
      "expired-callback": () => {
        try {
          win.recaptchaVerifier?.clear();
        } catch {}
        win.recaptchaVerifier = undefined;
      },
    });

    return await firebase.auth().signInWithPhoneNumber(phoneNumber, win.recaptchaVerifier);
  } catch (err: any) {
    // If invisible reCAPTCHA fails due to storage partitioning, try visible reCAPTCHA fallback
    const errMsg = err?.message || String(err);
    if (errMsg.includes("missing-initial-state") || errMsg.includes("sessionStorage") || errMsg.includes("storage-partitioned")) {
      console.warn("[Firebase Web Auth] Invisible reCAPTCHA blocked by storage partitioning. Attempting visible reCAPTCHA fallback...");
      try {
        if (win.recaptchaVerifier) {
          try { win.recaptchaVerifier.clear(); } catch {}
          win.recaptchaVerifier = undefined;
        }
        win.recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", {
          size: "normal",
        });
        await win.recaptchaVerifier.render();
        return await firebase.auth().signInWithPhoneNumber(phoneNumber, win.recaptchaVerifier);
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
    throw err;
  }
}
