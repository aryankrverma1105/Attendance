import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { initSelfieStorage } from "../selfie-storage";
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
  const app = express();
  app.set("trust proxy", 1);
  const server = createServer(app);

  // Security headers
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  // CORS configuration with strict allowlist
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOriginsEnv = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim().toLowerCase())
      : null;

    let isAllowed = false;
    if (origin) {
      const lowerOrigin = origin.toLowerCase();
      if (allowedOriginsEnv && allowedOriginsEnv.length > 0) {
        isAllowed = allowedOriginsEnv.includes(lowerOrigin);
      } else if (process.env.NODE_ENV !== "production") {
        // Dev fallback: allow localhost and 127.0.0.1 on any port
        isAllowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      }

      if (isAllowed) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Access-Control-Allow-Credentials", "true");
      }
    }

    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );

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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, status: "healthy", timestamp: Date.now() });
  });

  app.get("/api/ready", async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      res.json({ ok: true, status: "ready", dbConnected: !!db, timestamp: Date.now() });
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
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
