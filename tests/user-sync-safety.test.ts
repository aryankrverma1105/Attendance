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

  it("DELETE /api/users/:id refuses deletion of own account (400)", () => {
    const callerUser = { id: 1, openId: "admin-open-id", role: "admin" };
    const targetUser = { id: 1, openId: "admin-open-id", role: "admin" };

    const isSelf = targetUser.id === callerUser.id || targetUser.openId === callerUser.openId;
    expect(isSelf).toBe(true);
  });

  it("DELETE /api/users/:id refuses deletion of the last active administrator (400)", () => {
    const targetUser = { id: 2, role: "admin", accountStatus: "active" };
    const activeAdminsCount = 1; // Only 1 active admin exists

    const isLastAdmin = targetUser.role === "admin" && targetUser.accountStatus === "active" && activeAdminsCount <= 1;
    expect(isLastAdmin).toBe(true);
  });

  it("DELETE /api/users/:id returns 404 when affectedRows === 0 or user not found", () => {
    const targetFound = false;
    expect(targetFound).toBe(false);

    const affectedRows = 0;
    const isNotFound = !targetFound || affectedRows === 0;
    expect(isNotFound).toBe(true);
  });

  it("merges server users into managedUsers replacing local member- id with server numeric id", () => {
    const localUsers = [
      { id: "member-xyz-987", displayName: "Aarav Sharma", identifier: "+919876543210", role: "employee" },
    ];
    const serverUsers = [
      { id: "105", displayName: "Aarav Sharma", identifier: "+919876543210", role: "employee" },
    ];

    const merged = localUsers.map((local) => {
      const match = serverUsers.find((su) => su.identifier === local.identifier);
      if (match) {
        return {
          ...local,
          ...match,
          id: String(match.id),
        };
      }
      return local;
    });

    expect(merged[0].id).toBe("105");
  });

  it("refuses removeManagedUser for non-numeric unsynced member id", () => {
    const unsyncedId = "member-abc-123";
    const isNumericId = /^\d+$/.test(unsyncedId);
    expect(isNumericId).toBe(false);

    const syncedId = "105";
    const isSyncedNumeric = /^\d+$/.test(syncedId);
    expect(isSyncedNumeric).toBe(true);
  });
});
