import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

import { authedFetch, HttpError } from "../lib/_core/api";
import * as Auth from "../lib/_core/auth";

describe("authedFetch REST helper", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockPlatform.OS = "web";
  });

  it("throws typed HttpError containing HTTP status on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => JSON.stringify({ error: "Access denied" }),
    });

    let thrownError: any = null;
    try {
      await authedFetch("/api/users");
    } catch (err: any) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(HttpError);
    expect(thrownError.status).toBe(403);
    expect(thrownError.message).toBe("Access denied");
    expect(thrownError.body).toEqual({ error: "Access denied" });
  });

  it("throws typed HttpError on 401 Unauthorized", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: "Session expired" }),
    });

    let thrownError: any = null;
    try {
      await authedFetch("/api/users/sync", { method: "POST" });
    } catch (err: any) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(HttpError);
    expect(thrownError.status).toBe(401);
    expect(thrownError.message).toBe("Session expired");
  });

  it("attaches Authorization header with Bearer token on native platforms", async () => {
    mockPlatform.OS = "android";
    vi.spyOn(Auth, "getSessionToken").mockResolvedValue("test-token-xyz");

    let capturedHeaders: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: any) => {
      capturedHeaders = init?.headers;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      };
    });

    const res = await authedFetch("/api/users");
    expect(res.status).toBe(200);
    expect(capturedHeaders["Authorization"]).toBe("Bearer test-token-xyz");
  });

  it("uses credentials: 'include' on web platform", async () => {
    mockPlatform.OS = "web";

    let capturedInit: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: any) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      };
    });

    const res = await authedFetch("/api/users");
    expect(res.status).toBe(200);
    expect(capturedInit.credentials).toBe("include");
  });
});
