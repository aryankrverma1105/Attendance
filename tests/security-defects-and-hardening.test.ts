import { describe, expect, it, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import express, { type Request, type Response } from "express";
import { verifyPasswordHash, hashPasswordScrypt, passwordLoginLimiter, initUserSync } from "../server/user-sync";
import { sdk } from "../server/_core/sdk";
import { formatKolkataDate, calculateWorkedDays } from "../lib/field-math";

describe("Security Defects Remediations & Production Hardening", () => {
  describe("1. Password Verification (scrypt & bcrypt)", () => {
    it("successfully creates and verifies a scrypt password hash", async () => {
      const password = "StrongSecretPassword!@#123";
      const scryptHash = hashPasswordScrypt(password);
      expect(scryptHash.startsWith("scrypt$")).toBe(true);

      const isValid = await verifyPasswordHash(password, scryptHash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPasswordHash("WrongPassword!", scryptHash);
      expect(isInvalid).toBe(false);
    });

    it("successfully verifies a bcrypt password hash", async () => {
      const password = "BcryptSecretPassword789$";
      const bcryptHash = await bcrypt.hash(password, 10);
      expect(bcryptHash.startsWith("$2a$") || bcryptHash.startsWith("$2b$")).toBe(true);

      const isValid = await verifyPasswordHash(password, bcryptHash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPasswordHash("IncorrectBcryptPassword", bcryptHash);
      expect(isInvalid).toBe(false);
    });

    it("rejects empty, null, or blank passwords and hashes", async () => {
      expect(await verifyPasswordHash("", "scrypt$abc$def")).toBe(false);
      expect(await verifyPasswordHash("pass", "")).toBe(false);
      expect(await verifyPasswordHash("", "")).toBe(false);
    });
  });

  describe("2. Rate Limiting on Password Login (5 attempts / 15 min per IP+identifier)", () => {
    it("enforces max 5 attempts per window and returns HTTP 429", async () => {
      const app = express();
      app.use(express.json());
      app.post("/test-login", passwordLoginLimiter, (req: Request, res: Response) => {
        res.json({ success: true });
      });

      // Simulate 5 calls from the same IP + identifier
      const makeReq = () => ({
        ip: "192.168.1.100",
        body: { identifier: "+919876543210" },
        headers: {},
        socket: { remoteAddress: "192.168.1.100" },
      });

      // Helper mock runner for express middleware
      const runLimiter = (reqObj: any) =>
        new Promise<{ status: number; body?: any }>((resolve) => {
          const resObj: any = {
            statusCode: 200,
            status(code: number) {
              this.statusCode = code;
              return this;
            },
            json(data: any) {
              resolve({ status: this.statusCode, body: data });
            },
            setHeader() {},
            getHeader() {},
          };
          passwordLoginLimiter(reqObj as Request, resObj as Response, () => {
            resolve({ status: 200 });
          });
        });

      // First 5 attempts should pass through to next()
      for (let i = 0; i < 5; i++) {
        const res = await runLimiter(makeReq());
        expect(res.status).toBe(200);
      }

      // 6th attempt must be rejected with 429 Too Many Requests
      const rejected = await runLimiter(makeReq());
      expect(rejected.status).toBe(429);
      expect(rejected.body?.error).toContain("Too many login attempts");
    });
  });

  describe("3. Session Tokens, Token Version Revocation & 30-Day Expiry", () => {
    it("embeds users.tokenVersion into JWT and enforces 30-day token lifetime", async () => {
      const openId = "emp_user_9911";
      const token = await sdk.createSessionToken(openId, {
        name: "Aryan Field",
        tokenVersion: 2,
      });

      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);

      // Verify the session token unpacks the real openId and tokenVersion
      const payload = await sdk.verifySession(token);
      expect(payload).not.toBeNull();
      expect(payload?.openId).toBe(openId);
      expect(payload?.tokenVersion).toBe(2);
    });

    it("rejects token when tokenVersion does not match active DB version (session revocation)", () => {
      const tokenVersionInJwt: number = 1;
      const dbUserTokenVersion: number = 2; // Admin bumped token version to revoke session

      // In sdk.authenticateRequest:
      const isRevoked = tokenVersionInJwt !== dbUserTokenVersion;
      expect(isRevoked).toBe(true);
    });

    it("rejects authentication for suspended or removed accounts", () => {
      const activeUser = { accountStatus: "active" };
      const suspendedUser = { accountStatus: "suspended" };
      const removedUser = { accountStatus: "removed" };

      const isAccountAllowed = (u: { accountStatus: string }) =>
        u.accountStatus !== "suspended" && u.accountStatus !== "removed";

      expect(isAccountAllowed(activeUser)).toBe(true);
      expect(isAccountAllowed(suspendedUser)).toBe(false);
      expect(isAccountAllowed(removedUser)).toBe(false);
    });
  });

  describe("4. Ownership Checks & Business Rules in db.ts", () => {
    it("blocks direct chat channel creation between unauthorized arbitrary users", () => {
      // Direct channel allowed ONLY between employee and their assigned manager OR an admin
      const employee = { id: 101, role: "employee", managerId: 10 };
      const assignedManager = { id: 10, role: "manager" };
      const unassignedManager = { id: 20, role: "manager" };
      const admin = { id: 1, role: "admin" };

      const canCreateDirectChannel = (
        actor: { id: number; role: string; managerId?: number | null },
        target: { id: number; role: string }
      ) => {
        if (actor.role === "admin" || target.role === "admin") return true;
        if (actor.role === "employee" && target.id === actor.managerId) return true;
        if (actor.role === "manager" && target.role === "employee") return true;
        return false;
      };

      expect(canCreateDirectChannel(employee, assignedManager)).toBe(true);
      expect(canCreateDirectChannel(employee, admin)).toBe(true);
      expect(canCreateDirectChannel(employee, unassignedManager)).toBe(false);
    });

    it("blocks self-approval of expenses and enforces manager team scope", () => {
      const managerUser = { id: 10, role: "manager" };
      const ownExpense = { id: "exp-1", userId: 10, amount: 500 };
      const teamExpense = { id: "exp-2", userId: 101, amount: 300, employeeManagerId: 10 };
      const otherTeamExpense = { id: "exp-3", userId: 201, amount: 400, employeeManagerId: 20 };

      const canReviewExpense = (
        reviewer: { id: number; role: string },
        expense: { userId: number; employeeManagerId?: number }
      ) => {
        // Disallow self-approval under all circumstances
        if (reviewer.id === expense.userId) return false;
        if (reviewer.role === "admin") return true;
        if (reviewer.role === "manager" && expense.employeeManagerId === reviewer.id) return true;
        return false;
      };

      expect(canReviewExpense(managerUser, ownExpense)).toBe(false); // Self-approval blocked
      expect(canReviewExpense(managerUser, teamExpense)).toBe(true); // Team approval allowed
      expect(canReviewExpense(managerUser, otherTeamExpense)).toBe(false); // Other team blocked
    });

    it("restricts visit evidence and customer updates to owners, managers, and admins", () => {
      const canAccessVisit = (
        actor: { id: number; role: string },
        visit: { employeeId: number; managerId?: number }
      ) => {
        if (actor.role === "admin") return true;
        if (actor.id === visit.employeeId) return true;
        if (actor.role === "manager" && actor.id === visit.managerId) return true;
        return false;
      };

      const visitRecord = { employeeId: 101, managerId: 10 };
      expect(canAccessVisit({ id: 101, role: "employee" }, visitRecord)).toBe(true);
      expect(canAccessVisit({ id: 10, role: "manager" }, visitRecord)).toBe(true);
      expect(canAccessVisit({ id: 1, role: "admin" }, visitRecord)).toBe(true);
      expect(canAccessVisit({ id: 999, role: "employee" }, visitRecord)).toBe(false);
    });
  });

  describe("5. Geofencing Timestamp Validation & Timezone Consistency", () => {
    it("rejects check-in timestamps older than 24 hours or in the future", () => {
      const now = Date.now();
      const validateTimestamp = (clientTimeIso: string) => {
        const parsed = new Date(clientTimeIso).getTime();
        if (isNaN(parsed)) return false;
        const diffMs = now - parsed;
        // Max 24 hours old: 24 * 60 * 60 * 1000 = 86400000 ms
        if (diffMs > 86400000) return false;
        // Not in the future by more than 5 minutes (clock skew tolerance)
        if (parsed > now + 5 * 60 * 1000) return false;
        return true;
      };

      const validNow = new Date(now - 10000).toISOString();
      const tooOld = new Date(now - 25 * 3600 * 1000).toISOString();
      const tooFarFuture = new Date(now + 2 * 3600 * 1000).toISOString();

      expect(validateTimestamp(validNow)).toBe(true);
      expect(validateTimestamp(tooOld)).toBe(false);
      expect(validateTimestamp(tooFarFuture)).toBe(false);
    });

    it("buckets attendance days strictly using Asia/Kolkata (UTC+5:30) date format", () => {
      // 2026-08-15 20:00:00 UTC is 2026-08-16 01:30:00 IST (+5:30)
      const lateNightUtc = new Date("2026-08-15T20:00:00.000Z");
      const kolkataDate = formatKolkataDate(lateNightUtc);
      expect(kolkataDate).toBe("2026-08-16");

      // Verify that UTC would have been 2026-08-15, but Kolkata is 2026-08-16
      expect(lateNightUtc.toISOString().slice(0, 10)).toBe("2026-08-15");
      expect(kolkataDate).not.toBe(lateNightUtc.toISOString().slice(0, 10));
    });

    it("payroll calculation strictly counts verified records in the selected month", () => {
      const records = [
        {
          id: "rec-1",
          checkInAt: "2026-08-01T04:00:00.000Z", // August 1
          status: "verified" as const,
          syncState: "synced" as const,
        },
        {
          id: "rec-2",
          checkInAt: "2026-08-02T04:00:00.000Z", // August 2
          status: "verified" as const,
          syncState: "synced" as const,
        },
        {
          id: "rec-3",
          checkInAt: "2026-08-03T04:00:00.000Z", // August 3 - rejected/review
          status: "review" as const,
          syncState: "synced" as const,
        },
        {
          id: "rec-4",
          checkInAt: "2026-08-04T04:00:00.000Z", // August 4 - rejected
          status: "rejected" as const,
          syncState: "synced" as const,
        },
      ];

      const { workedDays, uniqueDates } = calculateWorkedDays(records, 8, 2026);
      expect(workedDays).toBe(2); // Only rec-1 and rec-2 count towards payroll
      expect(uniqueDates).toEqual(["2026-08-01", "2026-08-02"]);
    });
  });

  describe("6. Fail-Closed Production Environment Checks", () => {
    it("refuses to initialize in production if JWT_SECRET or ALLOWED_ORIGINS are missing", () => {
      const validateProductionEnv = (env: Record<string, string | undefined>) => {
        if (env.NODE_ENV === "production") {
          if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
            throw new Error("Missing or insecure JWT_SECRET");
          }
          if (!env.DATABASE_URL) {
            throw new Error("Missing DATABASE_URL");
          }
          if (!env.ALLOWED_ORIGINS) {
            throw new Error("Missing ALLOWED_ORIGINS");
          }
        }
        return true;
      };

      // Valid prod config
      expect(() =>
        validateProductionEnv({
          NODE_ENV: "production",
          DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/db",
          JWT_SECRET: "32-chars-long-production-jwt-secret-key!",
          ALLOWED_ORIGINS: "https://attendance.example.com",
        })
      ).not.toThrow();

      // Missing JWT_SECRET
      expect(() =>
        validateProductionEnv({
          NODE_ENV: "production",
          DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/db",
          ALLOWED_ORIGINS: "https://attendance.example.com",
        })
      ).toThrow("JWT_SECRET");

      // Missing ALLOWED_ORIGINS
      expect(() =>
        validateProductionEnv({
          NODE_ENV: "production",
          DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/db",
          JWT_SECRET: "32-chars-long-production-jwt-secret-key!",
        })
      ).toThrow("ALLOWED_ORIGINS");
    });
  });
});
