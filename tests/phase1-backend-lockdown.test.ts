import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../server/routers";
import { sdk } from "../server/_core/sdk";
import type { TrpcContext } from "../server/_core/context";
import type { User } from "../drizzle/schema";
import * as db from "../server/db";

function createMockContext(user: User | null): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      hostname: "api.example.com",
      headers: {
        authorization: "Bearer mock_token",
      },
    } as any,
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as any,
  };
}

describe("Phase 1: Backend Security Lockdown", () => {
  describe("Item 3: Mock-Token Auth Bypass Removal", () => {
    it("REJECTS mock tokens in production even with explicit Super Admin phone", async () => {
      vi.stubEnv("NODE_ENV", "production");

      try {
        const ctx = createMockContext(null);
        const caller = appRouter.createCaller(ctx);

        await expect(
          caller.auth.activate({
            idToken: "mock_token_phone_+919835916278",
          })
        ).rejects.toThrow(/Authentication token verification failed|Authentication failed/);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("REJECTS mock tokens in development if phone number is missing or invalid", async () => {
      vi.stubEnv("NODE_ENV", "development");

      try {
        const ctx = createMockContext(null);
        const caller = appRouter.createCaller(ctx);

        await expect(
          caller.auth.activate({
            idToken: "mock_token_phone_",
          })
        ).rejects.toThrow();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("Item 5: Account Status & Session Revocation", () => {
    it("REJECTS authentication when user accountStatus is suspended or removed", async () => {
      const mockReq = {
        headers: {
          authorization: "Bearer mock-session-token",
        },
      } as any;

      vi.spyOn(sdk, "verifySession").mockResolvedValueOnce({
        openId: "test-suspended-user",
        appId: "test-app",
        name: "Suspended User",
        sessionVersion: 1,
      });

      vi.spyOn(db, "getUserByOpenId").mockResolvedValueOnce({
        id: 99,
        openId: "test-suspended-user",
        firebaseUid: "fb-99",
        phoneE164: "+919999999999",
        name: "Suspended User",
        email: null,
        loginMethod: "phone",
        role: "employee",
        accountStatus: "suspended",
        dailyWage: 500,
        managerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
        sessionVersion: 1,
      } as User);

      await expect(sdk.authenticateRequest(mockReq)).rejects.toThrow(/Account is not active/);
    });

    it("REJECTS authentication when sessionVersion does not match current DB version", async () => {
      const mockReq = {
        headers: {
          authorization: "Bearer mock-stale-session-token",
        },
      } as any;

      vi.spyOn(sdk, "verifySession").mockResolvedValueOnce({
        openId: "test-stale-user",
        appId: "test-app",
        name: "Stale User",
        sessionVersion: 1, // Old session token
      });

      vi.spyOn(db, "getUserByOpenId").mockResolvedValueOnce({
        id: 100,
        openId: "test-stale-user",
        firebaseUid: "fb-100",
        phoneE164: "+919999999998",
        name: "Stale User",
        email: null,
        loginMethod: "phone",
        role: "employee",
        accountStatus: "active",
        dailyWage: 500,
        managerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
        sessionVersion: 2, // Incremented after role/status change
      } as User);

      await expect(sdk.authenticateRequest(mockReq)).rejects.toThrow(/Session expired or revoked/);
    });
  });

  describe("Item 7: Attendance Verification & Duplicate Check-in Prevention", () => {
    it("REQUIRES photoUri, latitude, and longitude for checkIn", async () => {
      const employeeUser: User = {
        id: 101,
        openId: "emp-101",
        firebaseUid: "fb-101",
        phoneE164: "+919999999997",
        name: "Field Employee",
        email: null,
        loginMethod: "phone",
        role: "employee",
        accountStatus: "active",
        dailyWage: 600,
        managerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
        sessionVersion: 1,
      };

      const ctx = createMockContext(employeeUser);
      const caller = appRouter.createCaller(ctx);

      // Missing checkInPhotoUri
      await expect(
        caller.attendance.checkIn({
          checkInLat: "28.5355",
          checkInLng: "77.3910",
        } as any)
      ).rejects.toThrow();

      // Missing latitude
      await expect(
        caller.attendance.checkIn({
          checkInPhotoUri: "selfie.jpg",
          checkInLng: "77.3910",
        } as any)
      ).rejects.toThrow();
    });
  });

  describe("Item 8: Wage Update Error on DB Unavailability", () => {
    it("THROWS when database is unavailable instead of silently succeeding", async () => {
      const realDb = await db.getDb();
      try {
        db.setDbForTesting(null);
        vi.stubEnv("DATABASE_URL", "");

        await expect(
          db.updateUserDailyWage("admin-open-id", "admin", 1, 101, 800)
        ).rejects.toThrow(/Database unavailable/);
      } finally {
        db.setDbForTesting(realDb);
        vi.unstubAllEnvs();
      }
    });
  });
});
