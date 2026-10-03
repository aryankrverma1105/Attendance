/**
 * Comprehensive Field Force Smoke Test
 *
 * Verifies real end-to-end functionality against a live database:
 * 1. Database readiness verification (fails gracefully with "DB TEST NOT EXECUTED" if offline)
 * 2. Real DB login & session generation
 * 3. Real attendance check-in insert
 * 4. Duplicate retry using same operationId (verifies server idempotency)
 * 5. Manager visibility of team attendance
 * 6. Logout / session revocation via tokenVersion increment
 * 7. Old session token rejection
 */

import { eq } from "drizzle-orm";
import { sdk } from "../server/_core/sdk";
import { appRouter } from "../server/routers";
import { checkDbReadiness, getDb, getUserById } from "../server/db";
import { users, attendanceRecords } from "../drizzle/schema";
import type { TrpcContext } from "../server/_core/context";

async function runSmokeTest() {
  console.log("=== STARTING PRODUCTION-GRADE SMOKE TEST ===");

  // STEP 0: Check Database Connectivity
  console.log("\n[Step 0] Checking database readiness...");
  const isDbReady = await checkDbReadiness().catch(() => false);
  if (!isDbReady) {
    console.error("\n=============================================");
    console.error("⚠️  DB TEST NOT EXECUTED");
    console.error("Database connection is unavailable or unreachable.");
    console.error("=============================================\n");
    process.exit(1);
  }
  console.log("✓ Database is connected and ready.");

  const db = await getDb();
  if (!db) {
    console.error("\n=============================================");
    console.error("⚠️  DB TEST NOT EXECUTED");
    console.error("Database handle could not be initialized.");
    console.error("=============================================\n");
    process.exit(1);
  }

  // Ensure test manager exists in DB
  const mgrOpenId = "smoke_mgr_test";
  const empOpenId = "smoke_emp_test";

  let mgrUser = (await db.select().from(users).where(eq(users.openId, mgrOpenId)).limit(1))[0];
  if (!mgrUser) {
    const [insertResult] = await db.insert(users).values({
      openId: mgrOpenId,
      name: "Smoke Test Operations Manager",
      email: "smoke_mgr@sologix.energy",
      phoneE164: "+919999990001",
      role: "manager",
      accountStatus: "active",
      tokenVersion: 1,
    });
    mgrUser = (await db.select().from(users).where(eq(users.id, insertResult.insertId)).limit(1))[0];
  } else {
    await db.update(users).set({ accountStatus: "active" }).where(eq(users.id, mgrUser.id));
    mgrUser = (await db.select().from(users).where(eq(users.id, mgrUser.id)).limit(1))[0];
  }

  // Ensure test employee exists in DB and is assigned to manager
  let empUser = (await db.select().from(users).where(eq(users.openId, empOpenId)).limit(1))[0];
  if (!empUser) {
    const [insertResult] = await db.insert(users).values({
      openId: empOpenId,
      name: "Smoke Test Field Worker",
      email: "smoke_emp@sologix.energy",
      phoneE164: "+919999990002",
      role: "employee",
      accountStatus: "active",
      managerId: mgrUser.id,
      tokenVersion: 1,
      dailyWage: 750,
    });
    empUser = (await db.select().from(users).where(eq(users.id, insertResult.insertId)).limit(1))[0];
  } else {
    await db
      .update(users)
      .set({ managerId: mgrUser.id, accountStatus: "active" })
      .where(eq(users.id, empUser.id));
    empUser = (await db.select().from(users).where(eq(users.id, empUser.id)).limit(1))[0];
  }

  // STEP 1: Real DB Employee Login & Session Token Generation
  console.log("\n[Step 1] Real DB Employee Login & Session Generation...");
  const employeeToken = await sdk.createSessionToken(empUser.openId, {
    name: empUser.name || "Employee",
    tokenVersion: empUser.tokenVersion,
  });
  console.log("✓ Login successful. Generated JWT token:", employeeToken.slice(0, 25) + "...");

  const mockEmpReq = {
    protocol: "https",
    hostname: "localhost",
    headers: {
      authorization: `Bearer ${employeeToken}`,
    },
  } as any;

  const authenticatedEmp = await sdk.authenticateRequest(mockEmpReq);
  if (!authenticatedEmp || authenticatedEmp.id !== empUser.id) {
    throw new Error(`Authentication failed: expected user ID ${empUser.id}, got ${authenticatedEmp?.id}`);
  }
  console.log("✓ Verified authenticated employee from DB:", authenticatedEmp.id, authenticatedEmp.name);

  // STEP 2: Real Attendance Check-In Insert
  console.log("\n[Step 2] Real Attendance Check-In Insert...");
  const empCtx: TrpcContext = {
    user: authenticatedEmp,
    req: mockEmpReq,
    res: { cookie: () => undefined, clearCookie: () => undefined } as any,
  };
  const empCaller = appRouter.createCaller(empCtx);

  const operationId = `smoke_checkin_${Date.now()}`;
  const checkInPayload = {
    checkInPhotoUri: "/uploads/selfies/selfie-smoke-test.jpg",
    checkInLat: "28.6139",
    checkInLng: "77.2090",
    checkInAccuracy: 25,
    operationId,
    clientCheckInAt: new Date().toISOString(),
  };

  const checkInResult = await empCaller.attendance.checkIn(checkInPayload);
  if (!checkInResult || !checkInResult.id) {
    throw new Error("Attendance check-in returned empty or invalid result");
  }
  console.log("✓ Attendance check-in recorded in database. Record ID:", checkInResult.id);

  // STEP 3: Duplicate Retry Using Same operationId (Idempotency)
  console.log("\n[Step 3] Idempotency: Duplicate Retry with Same operationId...");
  const retryResult = await empCaller.attendance.checkIn(checkInPayload);
  if (retryResult.id !== checkInResult.id) {
    throw new Error(
      `Idempotency failure: retry returned record ID ${retryResult.id} instead of original ID ${checkInResult.id}`
    );
  }

  const dbOpRecords = await db
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.operationId, operationId));
  if (dbOpRecords.length !== 1) {
    throw new Error(`Idempotency failure: expected exactly 1 DB record for operationId, found ${dbOpRecords.length}`);
  }
  console.log("✓ Replay with identical operationId returned original record without creating duplicate row.");

  // STEP 4: Manager Sees Inserted Attendance
  console.log("\n[Step 4] Manager Visibility: Query Team Attendance...");
  const managerToken = await sdk.createSessionToken(mgrUser.openId, {
    name: mgrUser.name || "Manager",
    tokenVersion: mgrUser.tokenVersion,
  });
  const mockMgrReq = {
    protocol: "https",
    hostname: "localhost",
    headers: {
      authorization: `Bearer ${managerToken}`,
    },
  } as any;

  const authenticatedMgr = await sdk.authenticateRequest(mockMgrReq);
  if (!authenticatedMgr || authenticatedMgr.id !== mgrUser.id) {
    throw new Error(`Manager authentication failed for user ID ${mgrUser.id}`);
  }

  const mgrCtx: TrpcContext = {
    user: authenticatedMgr,
    req: mockMgrReq,
    res: { cookie: () => undefined, clearCookie: () => undefined } as any,
  };
  const mgrCaller = appRouter.createCaller(mgrCtx);

  const teamAttendance = await mgrCaller.attendance.getTeamAttendance();
  const matchingRecord = teamAttendance.find((r: any) => r.id === checkInResult.id);
  if (!matchingRecord) {
    throw new Error(`Manager cannot see attendance record ${checkInResult.id} for team member ${empUser.id}`);
  }
  console.log("✓ Manager successfully verified team attendance record:", matchingRecord.id, "Status:", matchingRecord.status);

  // STEP 5: Logout / Session Revocation (bump tokenVersion in DB)
  console.log("\n[Step 5] Logout & Session Revocation...");
  const nextTokenVersion = (empUser.tokenVersion || 1) + 1;
  await db.update(users).set({ tokenVersion: nextTokenVersion }).where(eq(users.id, empUser.id));

  const refreshedEmp = await getUserById(empUser.id);
  if (refreshedEmp?.tokenVersion !== nextTokenVersion) {
    throw new Error("Failed to increment employee tokenVersion in database.");
  }
  console.log("✓ Employee tokenVersion bumped in DB to:", refreshedEmp.tokenVersion);

  // STEP 6: Old Token Rejected
  console.log("\n[Step 6] Verifying Old Token Invalidation...");
  let wasOldTokenRejected = false;
  try {
    await sdk.authenticateRequest(mockEmpReq);
  } catch (authError: any) {
    wasOldTokenRejected = true;
    console.log("✓ Old session token successfully REJECTED by server auth:", authError?.message || authError);
  }

  if (!wasOldTokenRejected) {
    throw new Error("Security failure: Old token was NOT rejected after session revocation!");
  }

  console.log("\n=============================================");
  console.log("🎉 ALL SMOKE TEST STEPS PASSED SUCCESSFULLY!");
  console.log("=============================================\n");
}

runSmokeTest().catch((err) => {
  console.error("\n❌ Smoke test failed:", err);
  process.exit(1);
});
