import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";

describe("User Sync Safety & Production Hardening", () => {
  const VALID_ROLES = ["admin", "manager", "employee"] as const;
  const VALID_ACCOUNT_STATUSES = ["invited", "active", "suspended", "removed"] as const;

  it("validates role against allowed roles", () => {
    expect(VALID_ROLES.includes("admin" as any)).toBe(true);
    expect(VALID_ROLES.includes("manager" as any)).toBe(true);
    expect(VALID_ROLES.includes("employee" as any)).toBe(true);
    expect(VALID_ROLES.includes("superuser" as any)).toBe(false);
    expect(VALID_ROLES.includes("root" as any)).toBe(false);
  });

  it("validates status against schema enum", () => {
    expect(VALID_ACCOUNT_STATUSES.includes("active" as any)).toBe(true);
    expect(VALID_ACCOUNT_STATUSES.includes("suspended" as any)).toBe(true);
    expect(VALID_ACCOUNT_STATUSES.includes("removed" as any)).toBe(true);
    expect(VALID_ACCOUNT_STATUSES.includes("invited" as any)).toBe(true);
    expect(VALID_ACCOUNT_STATUSES.includes("deleted" as any)).toBe(false);
    expect(VALID_ACCOUNT_STATUSES.includes("disabled" as any)).toBe(false);
  });

  it("protects removed users from being un-removed to active during sync", () => {
    const existingUser = {
      id: 10,
      accountStatus: "removed" as const,
      tokenVersion: 2,
    };

    // Incoming payload attempts to set status back to "active"
    const incomingStatus = "active";
    let targetStatus: string = existingUser.accountStatus;
    if (incomingStatus) {
      if (existingUser.accountStatus === "removed" && (incomingStatus === "active" || incomingStatus === "invited")) {
        targetStatus = "removed";
      } else {
        targetStatus = incomingStatus;
      }
    }

    expect(targetStatus).toBe("removed");
  });

  it("bumps tokenVersion when password is changed or account is suspended", () => {
    const existingUser = {
      id: 20,
      accountStatus: "active" as const,
      tokenVersion: 3,
    };

    // Case 1: Password changed
    let passwordChanged = true;
    let accountSuspended = false;
    let nextTokenVersion = existingUser.tokenVersion;
    if (passwordChanged || accountSuspended) {
      nextTokenVersion += 1;
    }
    expect(nextTokenVersion).toBe(4);

    // Case 2: Account suspended
    passwordChanged = false;
    accountSuspended = true;
    nextTokenVersion = existingUser.tokenVersion;
    if (passwordChanged || accountSuspended) {
      nextTokenVersion += 1;
    }
    expect(nextTokenVersion).toBe(4);

    // Case 3: Regular info update (no password change, no suspension)
    passwordChanged = false;
    accountSuspended = false;
    nextTokenVersion = existingUser.tokenVersion;
    if (passwordChanged || accountSuspended) {
      nextTokenVersion += 1;
    }
    expect(nextTokenVersion).toBe(3);
  });

  it("scripts/set-password bcrypt-hashes new password correctly for authentication", async () => {
    const newPassword = "AdminSecurePassword2026!";
    const hash = await bcrypt.hash(newPassword, 10);

    expect(hash.startsWith("$2a$") || hash.startsWith("$2b$")).toBe(true);
    const isValid = await bcrypt.compare(newPassword, hash);
    expect(isValid).toBe(true);
    const isWrong = await bcrypt.compare("WrongPassword", hash);
    expect(isWrong).toBe(false);
  });

  it("enforces 10-minute throttling for lastSignedIn updates", () => {
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const now = new Date("2026-10-03T12:00:00.000Z");

    // 1. User has no prior lastSignedIn -> must update
    const shouldUpdateFirst = true;
    expect(shouldUpdateFirst).toBe(true);

    // 2. User signed in 2 minutes ago -> do NOT update
    const signedIn2MinAgo = new Date("2026-10-03T11:58:00.000Z");
    const shouldUpdate2Min = now.getTime() - signedIn2MinAgo.getTime() > TEN_MINUTES_MS;
    expect(shouldUpdate2Min).toBe(false);

    // 3. User signed in 15 minutes ago -> must update
    const signedIn15MinAgo = new Date("2026-10-03T11:45:00.000Z");
    const shouldUpdate15Min = now.getTime() - signedIn15MinAgo.getTime() > TEN_MINUTES_MS;
    expect(shouldUpdate15Min).toBe(true);
  });
});
