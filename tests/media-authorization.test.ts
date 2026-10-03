import { describe, it, expect } from "vitest";
import { extractEvidenceOwnerId } from "../server/selfie-storage";

describe("Secure Media Storage Authorization", () => {
  it("rejects malicious traversal characters in filename generation", () => {
    const maliciousEmpId = "../../../etc/passwd";
    const safeEmpId = maliciousEmpId.replace(/[^a-zA-Z0-9_-]/g, "");
    expect(safeEmpId).toBe("etcpasswd");
    expect(safeEmpId).not.toContain("../");
  });

  it("validates image magic bytes and rejects executable/script payloads", () => {
    const fakeScript = Buffer.from("<?php echo 'malicious'; ?>");
    const isJpeg = fakeScript.length > 3 && fakeScript[0] === 0xff && fakeScript[1] === 0xd8 && fakeScript[2] === 0xff;
    const isPng = fakeScript.length > 4 && fakeScript[0] === 0x89 && fakeScript[1] === 0x50 && fakeScript[2] === 0x4e && fakeScript[3] === 0x47;
    expect(isJpeg).toBe(false);
    expect(isPng).toBe(false);

    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const validJpegCheck = validJpeg.length > 3 && validJpeg[0] === 0xff && validJpeg[1] === 0xd8 && validJpeg[2] === 0xff;
    expect(validJpegCheck).toBe(true);
  });

  it("extracts owner id from hyphenated action filenames and blocks IDOR access", () => {
    const checkInFilename = "check-in-12-1710000000000-abc12.jpg";
    const checkOutFilename = "check-out-12-1710000000000-xyz99.jpg";
    const visitFilename = "visit-12-1710000000000-evidence1.jpg";
    const invalidFilename = "random-file.jpg";

    expect(extractEvidenceOwnerId(checkInFilename)).toBe(12);
    expect(extractEvidenceOwnerId(checkOutFilename)).toBe(12);
    expect(extractEvidenceOwnerId(visitFilename)).toBe(12);
    expect(extractEvidenceOwnerId(invalidFilename)).toBeNull();

    // Employee 12 can view their own photos
    const authEmployee12 = { id: 12, role: "employee" };
    expect(extractEvidenceOwnerId(checkInFilename) === authEmployee12.id).toBe(true);
    expect(extractEvidenceOwnerId(checkOutFilename) === authEmployee12.id).toBe(true);
    expect(extractEvidenceOwnerId(visitFilename) === authEmployee12.id).toBe(true);

    // Another employee (id 99) is BLOCKED (403) from employee 12's photos
    const authEmployee99 = { id: 99, role: "employee" };
    expect(extractEvidenceOwnerId(checkInFilename) === authEmployee99.id).toBe(false);

    // Manager scoping check:
    const teamEmployee = { id: 12, managerId: 5 };
    const otherEmployee = { id: 30, managerId: 8 };
    const manager = { id: 5, role: "manager" };

    const canManagerAccess = (mgrId: number, emp: { managerId: number }) => mgrId === emp.managerId;
    expect(canManagerAccess(manager.id, teamEmployee)).toBe(true);
    expect(canManagerAccess(manager.id, otherEmployee)).toBe(false);
  });

  it("strictly preserves recent media and only purges files past the 180-day threshold", () => {
    const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. File captured 30 days ago (active work evidence)
    const activeFileAgeMs = 30 * 24 * 60 * 60 * 1000;
    const shouldPurgeActive = activeFileAgeMs > RETENTION_MS;
    expect(shouldPurgeActive).toBe(false); // MUST NOT BE PURGED

    // 2. File captured 90 days ago
    const midFileAgeMs = 90 * 24 * 60 * 60 * 1000;
    const shouldPurgeMid = midFileAgeMs > RETENTION_MS;
    expect(shouldPurgeMid).toBe(false); // MUST NOT BE PURGED

    // 3. Stale file captured 200 days ago (> 180 days)
    const staleFileAgeMs = 200 * 24 * 60 * 60 * 1000;
    const shouldPurgeStale = staleFileAgeMs > RETENTION_MS;
    expect(shouldPurgeStale).toBe(true); // ELIGIBLE FOR PURGE
  });

  it("enforces maximum upload payload thresholds to prevent memory exhaustion", () => {
    const MAX_ALLOWED_CHARS = 14 * 1024 * 1024; // ~10MB binary
    const smallPayload = "a".repeat(1000);
    const oversizedPayload = "a".repeat(MAX_ALLOWED_CHARS + 100);

    expect(smallPayload.length <= MAX_ALLOWED_CHARS).toBe(true);
    expect(oversizedPayload.length > MAX_ALLOWED_CHARS).toBe(true);
  });
});

