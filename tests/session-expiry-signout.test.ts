import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPlatform } = vi.hoisted(() => ({
  mockPlatform: { OS: "web" },
}));

vi.mock("react-native", () => ({
  Platform: mockPlatform,
}));

vi.mock("expo-modules-core", () => ({
  EventEmitter: class {},
  LegacyEventEmitter: class {},
  NativeModulesProxy: {},
  requireNativeModule: vi.fn(),
  requireOptionalNativeModule: vi.fn(),
  Platform: { OS: "web" },
}));

vi.mock("expo-linking", () => ({
  createURL: vi.fn(),
  addEventListener: vi.fn(),
}));

const mockStore = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => mockStore.get(key) || null),
  setItemAsync: vi.fn(async (key: string, val: string) => mockStore.set(key, val)),
  deleteItemAsync: vi.fn(async (key: string) => mockStore.delete(key)),
}));

const mockRouter = {
  replace: vi.fn(),
};

vi.mock("expo-router", () => ({
  router: mockRouter,
}));

import {
  setUnauthorizedListener,
  getUnauthorizedListener,
  handleGlobalUnauthorized,
  setSessionToken,
  removeSessionToken,
  clearUserInfo,
} from "../lib/_core/auth";

describe("Session Expiry & SignOut Listener", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore.clear();
    mockPlatform.OS = "web";
    await removeSessionToken();
    await clearUserInfo();
    setUnauthorizedListener(null);
  });

  it("registers and unregisters unauthorized listener properly", () => {
    const dummySignOut = vi.fn();
    setUnauthorizedListener(dummySignOut);
    expect(getUnauthorizedListener()).toBe(dummySignOut);

    setUnauthorizedListener(null);
    expect(getUnauthorizedListener()).toBeNull();
  });

  it("does NOT trigger when there is no active session", async () => {
    const signOutMock = vi.fn();
    setUnauthorizedListener(signOutMock, () => false);

    await handleGlobalUnauthorized("/api/auth/me");
    expect(signOutMock).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("does NOT trigger on login or activation endpoints", async () => {
    const signOutMock = vi.fn();
    setUnauthorizedListener(signOutMock, () => true);
    await setSessionToken("valid-token");

    await handleGlobalUnauthorized("/api/auth/password-login");
    await handleGlobalUnauthorized("/api/auth/login");
    await handleGlobalUnauthorized("auth.activate");

    expect(signOutMock).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("triggers signOut listener, clears credentials, and routes to /login without loop on 401", async () => {
    let sessionActive = true;
    const signOutMock = vi.fn(() => {
      sessionActive = false;
    });

    setUnauthorizedListener(signOutMock, () => sessionActive);
    // On web, user info in localStorage or sessionToken on native
    mockPlatform.OS = "ios";
    await setSessionToken("active-user-jwt-token");

    await handleGlobalUnauthorized("/api/users");

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith("/login");
    expect(sessionActive).toBe(false);

    // Second immediate call: session is gone and re-entry guard blocks it -> no redirect loop
    await handleGlobalUnauthorized("/api/users");
    expect(signOutMock).toHaveBeenCalledTimes(1); // not called again
  });
});
