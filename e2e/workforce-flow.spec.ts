import { test, expect } from "@playwright/test";

test.describe("FieldPulse Production Security & Endpoint E2E", () => {
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

  test("GET /api/users/check enforces phone parameter", async ({ request }) => {
    const res = await request.get("/api/users/check");
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("GET /api/users returns sanitized user roster without password leakage", async ({ request }) => {
    const res = await request.get("/api/users");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.users)).toBe(true);
    for (const user of body.users) {
      expect(user.password).toBeUndefined();
    }
  });
});
