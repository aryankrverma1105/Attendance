import { test, expect } from "@playwright/test";
import { sdk } from "../server/_core/sdk";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

test.describe("FieldPulse Production Security & Endpoint E2E", () => {
  let adminToken: string;

  test.beforeAll(async () => {
    const db = await getDb();
    if (db) {
      const adminOpenId = "e2e_admin_test_user";
      let admin = (await db.select().from(users).where(eq(users.openId, adminOpenId)).limit(1))[0];
      if (!admin) {
        const [insert] = await db.insert(users).values({
          openId: adminOpenId,
          name: "E2E Administrator",
          email: "e2e_admin@sologix.energy",
          phoneE164: "+919999990099",
          role: "admin",
          accountStatus: "active",
          tokenVersion: 1,
        });
        admin = (await db.select().from(users).where(eq(users.id, insert.insertId)).limit(1))[0];
      }
      adminToken = await sdk.createSessionToken(admin.openId, {
        name: admin.name || "Admin",
        tokenVersion: admin.tokenVersion,
      });
    }
  });

  test("GET /api/ready returns server status and db connectivity", async ({ request }) => {
    const res = await request.get("/api/ready");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.timestamp).toBeDefined();
  });

  test("HTTP Security headers are properly applied", async ({ request }) => {
    const res = await request.get("/api/ready");
    const headers = res.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-xss-protection"]).toBe("1; mode=block");
  });

  test("Unauthorized media access is rejected with 401", async ({ request }) => {
    const res = await request.get("/uploads/selfies/test-image.jpg");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication required");
  });

  test("Unauthenticated access to /api/users is rejected with 403", async ({ request }) => {
    const res = await request.get("/api/users");
    expect(res.status()).toBe(403);
  });

  test("GET /api/users/check enforces phone parameter", async ({ request }) => {
    const res = await request.get("/api/users/check", {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("GET /api/users returns sanitized user roster without password leakage", async ({ request }) => {
    const res = await request.get("/api/users", {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.users)).toBe(true);
    for (const user of body.users) {
      expect(user.password).toBeUndefined();
      expect(user.passwordHash).toBeUndefined();
    }
  });
});
