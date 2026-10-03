import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { SESSION_TOKEN_KEY, USER_INFO_KEY } from "@/constants/oauth";

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: Date;
};

export async function getSessionToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return null;
    }
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch (error) {
    console.error("[Auth] Failed to get session token:", error);
    return null;
  }
}

export async function setSessionToken(token: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      return;
    }
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  } catch (error) {
    console.error("[Auth] Failed to set session token:", error);
    throw error;
  }
}

export async function removeSessionToken(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      return;
    }
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch (error) {
    console.error("[Auth] Failed to remove session token:", error);
  }
}

export async function getUserInfo(): Promise<User | null> {
  try {
    let info: string | null = null;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        info = window.localStorage.getItem(USER_INFO_KEY);
      }
    } else {
      info = await SecureStore.getItemAsync(USER_INFO_KEY);
    }

    if (!info) {
      return null;
    }
    return JSON.parse(info);
  } catch (error) {
    console.error("[Auth] Failed to get user info:", error);
    return null;
  }
}

export async function setUserInfo(user: User): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
      }
      return;
    }
    await SecureStore.setItemAsync(USER_INFO_KEY, JSON.stringify(user));
  } catch (error) {
    console.error("[Auth] Failed to set user info:", error);
  }
}

export async function clearUserInfo(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(USER_INFO_KEY);
      }
      return;
    }
    await SecureStore.deleteItemAsync(USER_INFO_KEY);
  } catch (error) {
    console.error("[Auth] Failed to clear user info:", error);
  }
}

let _isHandlingUnauthorized = false;
let _unauthorizedListener: (() => void) | null = null;
let _hasSessionFn: (() => boolean) | null = null;

export function setUnauthorizedListener(fn: (() => void) | null, hasSession?: () => boolean): void {
  _unauthorizedListener = fn;
  if (hasSession) _hasSessionFn = hasSession;
  else if (fn === null) _hasSessionFn = null;
}

export function getUnauthorizedListener(): (() => void) | null {
  return _unauthorizedListener;
}

/**
 * Global 401 / UNAUTHORIZED handler:
 * Clears session token, cached user info, offline-queue pause state, calls registered signOut listener,
 * and redirects to /login.
 * Excludes login / activation endpoints. Do not trigger when there is no session.
 */
export async function handleGlobalUnauthorized(endpointUrlOrPath?: string): Promise<void> {
  if (endpointUrlOrPath) {
    const lower = endpointUrlOrPath.toLowerCase();
    const isLoginEndpoint =
      lower.includes("password-login") ||
      lower.includes("/login") ||
      lower.includes("auth.activate");
    if (isLoginEndpoint) return;
  }

  // Do not trigger when there is no session
  const token = await getSessionToken();
  const userInfo = await getUserInfo();
  const listenerHasSession = _hasSessionFn ? _hasSessionFn() : true;
  if (!listenerHasSession || (!token && !userInfo)) {
    return;
  }

  if (_isHandlingUnauthorized) return;
  _isHandlingUnauthorized = true;

  try {
    await removeSessionToken();
    await clearUserInfo();

    try {
      const { resumeQueue } = await import("@/lib/offline-sync");
      resumeQueue();
    } catch {
      // ignore
    }

    if (_unauthorizedListener) {
      try {
        _unauthorizedListener();
      } catch (err) {
        console.warn("[Auth] Unauthorized listener error:", err);
      }
    }

    try {
      const { router } = await import("expo-router");
      router.replace("/login");
    } catch (err) {
      console.warn("[Auth] Failed to route to /login on 401:", err);
    }
  } finally {
    setTimeout(() => {
      _isHandlingUnauthorized = false;
    }, 2000);
  }
}

