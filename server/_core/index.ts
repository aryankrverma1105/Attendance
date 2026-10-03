import "dotenv/config";
import express from "express";
import fs from "fs";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { initSelfieStorage } from "../selfie-storage";
import { initUserSync } from "../user-sync";
import { appRouter } from "../routers";
import { createContext } from "./context";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const requiredEnv = ["DATABASE_URL", "JWT_SECRET", "ALLOWED_ORIGINS"];
    const missing = requiredEnv.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      console.error(`[Startup] CRITICAL ERROR: Missing required production environment variables: ${missing.join(", ")}`);
      process.exit(1);
    }
  }

  const app = express();
  app.set("trust proxy", 1);
  const server = createServer(app);

  // Security headers
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    if (isProd) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  // CORS configuration with production allowlist support
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
      : null;

    if (origin) {
      if (allowedOrigins) {
        if (allowedOrigins.includes(origin)) {
          res.header("Access-Control-Allow-Origin", origin);
        }
      } else {
        res.header("Access-Control-Allow-Origin", origin);
      }
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  initSelfieStorage(app);
  initUserSync(app);

  // Startup environment warnings
  const fbServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!fbServiceAccountPath) {
    console.warn("⚠️  [Startup Warning] FIREBASE_SERVICE_ACCOUNT is unset. Phone OTP authentication and push notifications may fail.");
  } else {
    try {
      if (!fs.existsSync(fbServiceAccountPath)) {
        console.warn(`⚠️  [Startup Warning] FIREBASE_SERVICE_ACCOUNT file not found: ${fbServiceAccountPath}`);
      } else {
        const fileContent = fs.readFileSync(fbServiceAccountPath, "utf-8");
        JSON.parse(fileContent);
      }
    } catch (e: any) {
      console.warn(`⚠️  [Startup Warning] FIREBASE_SERVICE_ACCOUNT file is unreadable or invalid JSON: ${e.message}`);
    }
  }

  if (!process.env.SUPER_ADMIN_PHONE) {
    console.warn("⚠️  [Startup Warning] SUPER_ADMIN_PHONE is unset. Primary super administrator was not seeded.");
  }

  // Database connectivity and seeding
  try {
    const { pingDb, seedSuperAdmin } = await import("../db");
    if (isProd) {
      const isDbAlive = await pingDb();
      if (!isDbAlive) {
        console.error("[Startup] FATAL: Production database ping failed. Server cannot start.");
        process.exit(1);
      }
    }
    await seedSuperAdmin();
  } catch (err) {
    if (isProd) {
      console.error("[Startup] FATAL: Database initialization failed in production:", err);
      process.exit(1);
    }
    console.warn("[Startup] Failed to seed super admin:", err);
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, status: "healthy", timestamp: Date.now() });
  });

  app.get("/api/ready", async (_req, res) => {
    try {
      const { pingDb } = await import("../db");
      const isAlive = await pingDb();
      if (!isAlive) {
        return res.status(503).json({ ok: false, status: "unready", error: "Database ping failed" });
      }
      res.json({ ok: true, status: "ready", dbConnected: true, timestamp: Date.now() });
    } catch (err: any) {
      res.status(503).json({ ok: false, status: "unready", error: err?.message || String(err) });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const isPreferredAvailable = await isPortAvailable(preferredPort);

  if (!isPreferredAvailable) {
    if (isProd) {
      console.error(`[Startup] FATAL: Preferred port ${preferredPort} is busy. Exiting in production.`);
      process.exit(1);
    }
    console.log(`Port ${preferredPort} is busy, searching for alternative port...`);
  }

  const port = isPreferredAvailable ? preferredPort : await findAvailablePort(preferredPort + 1);

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
