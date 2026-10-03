import type { Express, Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq, or } from "drizzle-orm";
import { sdk } from "./_core/sdk";

export async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !password) return false;
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    return await bcrypt.compare(password, storedHash);
  }
  if (storedHash.startsWith("scrypt$") || storedHash.startsWith("scrypt:")) {
    const parts = storedHash.includes("$") ? storedHash.split("$") : storedHash.split(":");
    if (parts.length >= 3) {
      const salt = parts[1];
      const originalHash = parts[2];
      const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
      if (derivedKey.length === originalHash.length) {
        return crypto.timingSafeEqual(Buffer.from(derivedKey, "hex"), Buffer.from(originalHash, "hex"));
      }
    }
  }
  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    return false;
  }
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

function normalizePhone(p: string): string {
  const digits = (p || "").replace(/[^0-9]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function formatE164(p: string): string {
  let clean = (p || "").trim();
  const digits = clean.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (!clean.startsWith("+") && digits.length > 0) return `+${digits}`;
  return clean;
}

/**
 * Strict Rate Limiter for Password Login:
 * 5 attempts per 15 minutes scoped per IP + identifier.
 */
export const passwordLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req: Request) => {
    const rawIdentifier = String(req.body?.identifier || "").trim().toLowerCase();
    const ip = req.ip || (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown_ip";
    return `${ip}_${rawIdentifier}`;
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: "Too many login attempts. Please try again after 15 minutes.",
    });
  },
});

export function initUserSync(app: Express) {
  /**
   * GET /api/users
   * Return all managed users across the organization from MySQL only.
   * Access restricted strictly to administrators.
   * Passwords and password hashes are NEVER returned.
   */
  app.get("/api/users", async (req: Request, res: Response) => {
    try {
      const authUser = await sdk.authenticateRequest(req);
      if (authUser.role !== "admin") {
        return res.status(403).json({ success: false, error: "Only administrators can access user roster" });
      }

      const db = await getDb();
      if (!db) {
        return res.status(503).json({ success: false, error: "Database unavailable" });
      }

      const dbUsers = await db
        .select({
          id: users.id,
          openId: users.openId,
          firebaseUid: users.firebaseUid,
          phoneE164: users.phoneE164,
          name: users.name,
          email: users.email,
          role: users.role,
          accountStatus: users.accountStatus,
          dailyWage: users.dailyWage,
          managerId: users.managerId,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          lastSignedIn: users.lastSignedIn,
        })
        .from(users);

      const sanitized = dbUsers.map((u) => ({
        id: String(u.id),
        displayName: u.name || "Employee",
        identifier: u.phoneE164 || u.openId,
        role: u.role,
        status: u.accountStatus,
        dailyWage: u.dailyWage,
        managerId: u.managerId ? String(u.managerId) : undefined,
        createdAt: u.createdAt.toISOString(),
      }));

      res.json({ success: true, users: sanitized });
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403 || error?.statusCode === 401 || error?.statusCode === 403) {
        return res.status(error.status || error.statusCode || 401).json({ success: false, error: error.message || "Authentication required" });
      }
      console.error("[UserSync] Failed to list users:", error);
      res.status(500).json({ success: false, error: "Failed to list users" });
    }
  });

  /**
   * GET /api/users/check?phone=...
   * Look up user by phone or openId from MySQL only.
   * Requires Admin authorization. Passwords NEVER returned.
   */
  app.get("/api/users/check", async (req: Request, res: Response) => {
    try {
      const authUser = await sdk.authenticateRequest(req);
      if (authUser.role !== "admin") {
        return res.status(403).json({ success: false, error: "Only administrators can inspect user accounts" });
      }

      const queryPhone = String(req.query.phone || req.query.identifier || "").trim();
      if (!queryPhone) {
        return res.status(400).json({ success: false, error: "phone is required" });
      }

      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, error: "Database unavailable" });

      const e164 = formatE164(queryPhone);
      const digits = normalizePhone(queryPhone);

      const matched = await db
        .select({
          id: users.id,
          openId: users.openId,
          phoneE164: users.phoneE164,
          name: users.name,
          email: users.email,
          role: users.role,
          accountStatus: users.accountStatus,
          dailyWage: users.dailyWage,
          managerId: users.managerId,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(
          or(
            eq(users.phoneE164, e164),
            eq(users.phoneE164, `+91${digits}`),
            eq(users.openId, queryPhone),
            eq(users.email, queryPhone)
          )
        )
        .limit(1);

      if (matched.length > 0) {
        const u = matched[0];
        return res.json({
          success: true,
          found: true,
          user: {
            id: String(u.id),
            displayName: u.name || "Employee",
            identifier: u.phoneE164 || u.openId,
            role: u.role,
            status: u.accountStatus,
            dailyWage: u.dailyWage,
            createdAt: u.createdAt.toISOString(),
          },
        });
      }

      return res.json({ success: true, found: false });
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403 || error?.statusCode === 401 || error?.statusCode === 403) {
        return res.status(error.status || error.statusCode || 401).json({ success: false, error: error.message || "Authentication required" });
      }
      console.error("[UserSync] Failed to check user:", error);
      res.status(500).json({ success: false, error: "Failed to check user" });
    }
  });

  /**
   * POST /api/auth/password-login
   * Validates credentials against MySQL users.passwordHash ONLY.
   * Checks accountStatus === "active", signs JWT with REAL users.openId.
   * Rate limited: 5 attempts per 15 minutes per IP + identifier.
   */
  app.post("/api/auth/password-login", passwordLoginLimiter, async (req: Request, res: Response) => {
    try {
      const { identifier, password } = req.body || {};
      if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
        return res.status(400).json({ success: false, error: "Identifier is required" });
      }
      if (!password || typeof password !== "string" || !password.trim()) {
        return res.status(400).json({ success: false, error: "Password is required" });
      }

      const db = await getDb();
      if (!db) {
        return res.status(503).json({ success: false, error: "Database unavailable" });
      }

      const qIdentifier = identifier.trim();
      const e164 = formatE164(qIdentifier);
      const digits = normalizePhone(qIdentifier);

      const dbMatch = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.phoneE164, e164),
            eq(users.phoneE164, `+91${digits}`),
            eq(users.phoneE164, qIdentifier),
            eq(users.openId, qIdentifier),
            eq(users.email, qIdentifier)
          )
        )
        .limit(1);

      if (dbMatch.length === 0) {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
      }

      const targetUser = dbMatch[0];

      // Enforce active account status
      if (targetUser.accountStatus !== "active") {
        return res.status(403).json({
          success: false,
          error: "Account is not active or has been suspended by an administrator",
        });
      }

      // Enforce password hash presence
      if (!targetUser.passwordHash) {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
      }

      // Verify scrypt/bcrypt hash
      const isPasswordValid = await verifyPasswordHash(password, targetUser.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
      }

      // Update lastSignedIn
      await db
        .update(users)
        .set({ lastSignedIn: new Date() })
        .where(eq(users.id, targetUser.id));

      // Sign JWT with REAL openId and tokenVersion
      const token = await sdk.createSessionToken(targetUser.openId, {
        name: targetUser.name || "User",
        tokenVersion: targetUser.tokenVersion ?? 1,
      });

      return res.json({
        success: true,
        token,
        user: {
          id: targetUser.id,
          openId: targetUser.openId,
          phoneE164: targetUser.phoneE164,
          name: targetUser.name,
          role: targetUser.role,
          accountStatus: targetUser.accountStatus,
          dailyWage: targetUser.dailyWage,
          managerId: targetUser.managerId,
        },
      });
    } catch (err) {
      console.error("[Auth] Password login error:", err);
      res.status(500).json({ success: false, error: "Internal server error during login" });
    }
  });

  /**
   * POST /api/users/sync
   * Create or update users directly in MySQL. Admin only. No managers.
   */
  app.post("/api/users/sync", async (req: Request, res: Response) => {
    try {
      const authUser = await sdk.authenticateRequest(req);
      if (authUser.role !== "admin") {
        return res.status(403).json({ success: false, error: "Only administrators can modify user roster" });
      }

      const body = req.body;
      const incomingList = Array.isArray(body?.users) ? body.users : body?.user ? [body.user] : [];

      if (incomingList.length === 0) {
        return res.status(400).json({ success: false, error: "No users provided" });
      }

      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, error: "Database unavailable" });

      for (const u of incomingList) {
        const phone = formatE164(u.identifier || u.phoneE164 || "");
        if (!phone) continue;

        const existing = await db.select().from(users).where(eq(users.phoneE164, phone)).limit(1);
        if (existing.length === 0) {
          const openId = `user_${normalizePhone(phone)}_${Date.now()}`;
          let passwordHash: string | null = null;
          if (u.password && typeof u.password === "string" && u.password.trim()) {
            passwordHash = await bcrypt.hash(u.password.trim(), 10);
          }

          await db.insert(users).values({
            openId,
            phoneE164: phone,
            name: u.displayName || u.name || "Employee",
            role: u.role || "employee",
            accountStatus: u.status === "suspended" ? "suspended" : "active",
            dailyWage: u.dailyWage || 0,
            loginMethod: "password",
            passwordHash,
          });
        } else {
          const updateData: any = {
            name: u.displayName || u.name || existing[0].name,
            role: u.role || existing[0].role,
            accountStatus: u.status === "suspended" ? "suspended" : "active",
            dailyWage: u.dailyWage !== undefined ? u.dailyWage : existing[0].dailyWage,
          };
          if (u.password && typeof u.password === "string" && u.password.trim()) {
            updateData.passwordHash = await bcrypt.hash(u.password.trim(), 10);
          }

          await db.update(users).set(updateData).where(eq(users.id, existing[0].id));
        }
      }

      const currentDbUsers = await db
        .select({
          id: users.id,
          openId: users.openId,
          phoneE164: users.phoneE164,
          name: users.name,
          role: users.role,
          accountStatus: users.accountStatus,
          dailyWage: users.dailyWage,
          createdAt: users.createdAt,
        })
        .from(users);

      const mapped = currentDbUsers.map((u) => ({
        id: String(u.id),
        displayName: u.name || "Employee",
        identifier: u.phoneE164 || u.openId,
        role: u.role,
        status: u.accountStatus,
        dailyWage: u.dailyWage,
        createdAt: u.createdAt.toISOString(),
      }));

      res.json({ success: true, users: mapped });
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403 || error?.statusCode === 401 || error?.statusCode === 403) {
        return res.status(error.status || error.statusCode || 401).json({ success: false, error: error.message || "Authentication required" });
      }
      console.error("[UserSync] Sync failed:", error);
      res.status(500).json({ success: false, error: "Sync failed" });
    }
  });

  /**
   * DELETE /api/users/:id
   * Soft-delete user in MySQL (sets accountStatus = 'removed').
   * Admin only. No managers.
   */
  app.delete("/api/users/:id", async (req: Request, res: Response) => {
    try {
      const authUser = await sdk.authenticateRequest(req);
      if (authUser.role !== "admin") {
        return res.status(403).json({ success: false, error: "Only administrators can delete user accounts" });
      }

      const targetId = req.params.id;
      const numericId = parseInt(targetId, 10);

      const db = await getDb();
      if (!db) return res.status(503).json({ success: false, error: "Database unavailable" });

      if (!isNaN(numericId)) {
        await db.update(users).set({ accountStatus: "removed" }).where(eq(users.id, numericId));
      } else {
        await db.update(users).set({ accountStatus: "removed" }).where(eq(users.openId, targetId));
      }

      res.json({ success: true, message: "User removed successfully" });
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403 || error?.statusCode === 401 || error?.statusCode === 403) {
        return res.status(error.status || error.statusCode || 401).json({ success: false, error: error.message || "Authentication required" });
      }
      console.error("[UserSync] Delete failed:", error);
      res.status(500).json({ success: false, error: "Delete failed" });
    }
  });
}
