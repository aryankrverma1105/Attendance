import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq, or } from "drizzle-orm";

export interface SyncUser {
  id: string;
  accountLinkId?: string;
  displayName: string;
  identifier: string;
  role: "admin" | "manager" | "employee";
  status: "active" | "suspended" | "removed";
  dailyWage?: number;
  department?: string;
  managerId?: string;
  password?: string;
  createdAt?: string;
}

const STORAGE_DIR = path.join(process.cwd(), "uploads");
const USERS_FILE = path.join(STORAGE_DIR, "managed-users.json");

// Default initial users
const DEFAULT_USERS: SyncUser[] = [
  {
    id: "admin-sologix-primary",
    accountLinkId: "account-admin-sologix",
    displayName: "Aryan Kumar Verma",
    identifier: "+919835916278",
    role: "admin",
    status: "active",
    dailyWage: 0,
    createdAt: new Date().toISOString(),
  },
];

function normalizePhone(p: string): string {
  const digits = (p || "").replace(/[^0-9]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function loadDiskUsers(): SyncUser[] {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, "utf-8");
      const parsed = JSON.parse(data) as SyncUser[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Ensure primary admin is always present
        const hasPrimary = parsed.some((u) => u.identifier.includes("9835916278"));
        if (!hasPrimary) {
          parsed.unshift(DEFAULT_USERS[0]);
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error("[UserSync] Error reading disk users:", err);
  }
  return [...DEFAULT_USERS];
}

function saveDiskUsers(userList: SyncUser[]) {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(userList, null, 2), "utf-8");
  } catch (err) {
    console.error("[UserSync] Error writing disk users:", err);
  }
}

export function initUserSync(app: Express) {
  // Ensure storage exists on startup
  const initial = loadDiskUsers();
  saveDiskUsers(initial);

  /**
   * GET /api/users
   * Return all managed users across the entire organization
   */
  app.get("/api/users", async (_req: Request, res: Response) => {
    try {
      const diskUsers = loadDiskUsers();

      // Optionally supplement with database users
      try {
        const db = await getDb();
        if (db) {
          const dbUsers = await db.select().from(users);
          for (const dbu of dbUsers) {
            const dbuDigits = normalizePhone(dbu.phoneE164 || "");
            const exists = diskUsers.find((du) => normalizePhone(du.identifier) === dbuDigits);
            if (!exists && dbu.phoneE164) {
              diskUsers.push({
                id: `db-${dbu.id}`,
                displayName: dbu.name || "Employee",
                identifier: dbu.phoneE164,
                role: dbu.role === "admin" ? "admin" : dbu.role === "manager" ? "manager" : "employee",
                status: dbu.accountStatus === "suspended" ? "suspended" : "active",
                dailyWage: dbu.dailyWage || 0,
                createdAt: dbu.createdAt?.toISOString() || new Date().toISOString(),
              });
            }
          }
        }
      } catch (dbErr) {
        // DB optional; disk storage handles full persistence
      }

      res.json({ success: true, users: diskUsers });
    } catch (error) {
      console.error("[UserSync] Failed to list users:", error);
      res.status(500).json({ success: false, error: "Failed to list users" });
    }
  });

  /**
   * GET /api/users/check?phone=...
   * Check user role and profile by phone number or identifier
   */
  app.get("/api/users/check", async (req: Request, res: Response) => {
    try {
      const queryPhone = String(req.query.phone || req.query.identifier || "").trim();
      if (!queryPhone) {
        return res.status(400).json({ success: false, error: "phone is required" });
      }

      const qDigits = normalizePhone(queryPhone);
      const qLower = queryPhone.toLowerCase();
      const diskUsers = loadDiskUsers();

      const matched = diskUsers.find((u) => {
        const uDigits = normalizePhone(u.identifier);
        const uName = (u.displayName || "").toLowerCase().trim();
        return (
          (qDigits && uDigits && qDigits === uDigits) ||
          u.identifier.toLowerCase() === qLower ||
          uName === qLower
        );
      });

      if (matched) {
        return res.json({ success: true, found: true, user: matched });
      }

      // Check DB if not found in disk
      try {
        const db = await getDb();
        if (db && qDigits) {
          const dbMatch = await db
            .select()
            .from(users)
            .where(or(eq(users.phoneE164, `+91${qDigits}`), eq(users.phoneE164, queryPhone)))
            .limit(1);

          if (dbMatch.length > 0) {
            const u = dbMatch[0];
            const mappedUser: SyncUser = {
              id: `db-${u.id}`,
              displayName: u.name || "Employee",
              identifier: u.phoneE164 || queryPhone,
              role: u.role === "admin" ? "admin" : u.role === "manager" ? "manager" : "employee",
              status: u.accountStatus === "suspended" ? "suspended" : "active",
              dailyWage: u.dailyWage || 0,
              createdAt: u.createdAt?.toISOString() || new Date().toISOString(),
            };
            return res.json({ success: true, found: true, user: mappedUser });
          }
        }
      } catch {}

      return res.json({ success: true, found: false });
    } catch (error) {
      console.error("[UserSync] Failed to check user:", error);
      res.status(500).json({ success: false, error: "Failed to check user" });
    }
  });

  /**
   * POST /api/users/sync
   * Create or update managed users and broadcast to storage
   */
  app.post("/api/users/sync", async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const incomingList: SyncUser[] = Array.isArray(body?.users)
        ? body.users
        : body?.user
        ? [body.user]
        : [];

      if (incomingList.length === 0) {
        return res.status(400).json({ success: false, error: "No users provided" });
      }

      const currentUsers = loadDiskUsers();

      for (const incoming of incomingList) {
        const incDigits = normalizePhone(incoming.identifier);
        const existingIndex = currentUsers.findIndex((u) => {
          const uDigits = normalizePhone(u.identifier);
          return (
            (incDigits && uDigits && incDigits === uDigits) ||
            u.id === incoming.id ||
            u.identifier.toLowerCase() === incoming.identifier.toLowerCase()
          );
        });

        if (existingIndex >= 0) {
          // Update existing user, preserving admin role if assigned
          currentUsers[existingIndex] = {
            ...currentUsers[existingIndex],
            ...incoming,
            // Never demote Super Admin
            role: currentUsers[existingIndex].identifier.includes("9835916278")
              ? "admin"
              : incoming.role || currentUsers[existingIndex].role,
          };
        } else {
          // Insert new user
          currentUsers.push(incoming);
        }
      }

      saveDiskUsers(currentUsers);

      // Async sync to database if available
      try {
        const db = await getDb();
        if (db) {
          for (const u of incomingList) {
            let phone = u.identifier.trim();
            if (/^\d{10}$/.test(phone)) phone = `+91${phone}`;
            else if (!phone.startsWith("+")) phone = `+${phone}`;

            const existing = await db.select().from(users).where(eq(users.phoneE164, phone)).limit(1);
            if (existing.length === 0) {
              const openId = `user_${normalizePhone(phone)}_${Date.now()}`;
              await db.insert(users).values({
                openId,
                phoneE164: phone,
                name: u.displayName,
                role: u.role,
                accountStatus: u.status === "suspended" ? "suspended" : "active",
                dailyWage: u.dailyWage || 0,
                loginMethod: "firebase",
              });
            } else {
              await db
                .update(users)
                .set({
                  name: u.displayName,
                  role: u.role,
                  accountStatus: u.status === "suspended" ? "suspended" : "active",
                  dailyWage: u.dailyWage || 0,
                })
                .where(eq(users.id, existing[0].id));
            }
          }
        }
      } catch (dbErr) {
        console.warn("[UserSync] DB write warning:", dbErr);
      }

      res.json({ success: true, users: currentUsers });
    } catch (error) {
      console.error("[UserSync] Sync failed:", error);
      res.status(500).json({ success: false, error: "Sync failed" });
    }
  });

  /**
   * DELETE /api/users/:id
   * Soft-delete or remove a user
   */
  app.delete("/api/users/:id", (req: Request, res: Response) => {
    try {
      const targetId = req.params.id;
      const currentUsers = loadDiskUsers();

      const filtered = currentUsers.filter((u) => {
        // Never remove Super Admin
        if (u.identifier.includes("9835916278")) return true;
        return u.id !== targetId && normalizePhone(u.identifier) !== normalizePhone(targetId);
      });

      saveDiskUsers(filtered);
      res.json({ success: true, users: filtered });
    } catch (error) {
      console.error("[UserSync] Delete failed:", error);
      res.status(500).json({ success: false, error: "Delete failed" });
    }
  });
}
