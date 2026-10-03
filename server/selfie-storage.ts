import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "selfies");
const RETENTION_DAYS = 180; // 6 Months (approx 180 days)
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Ensure upload directory exists
export function initSelfieStorage(app: Express) {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  /**
   * Authorized media serving handler.
   * Serves ONLY /uploads/selfies/* (never the whole uploads directory).
   * Always requires authentication (unless explicit ALLOW_INSECURE_DEV=true).
   */
  app.get("/uploads/selfies/*", async (req: Request, res: Response) => {
    try {
      // Support query token, Bearer auth, or cookie
      if (req.query.token && typeof req.query.token === "string" && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${req.query.token}`;
      }

      const isDevBypass = process.env.ALLOW_INSECURE_DEV === "true";

      if (!isDevBypass) {
        const authUser = await sdk.authenticateRequest(req);
        if (authUser.role === "employee") {
          const requestedFilename = path.basename(req.path);
          const parts = requestedFilename.split("-");
          // file pattern: ${action}-${employeeId}-${timestamp}-${rand}.jpg
          if (parts.length >= 3 && parts[1] && parts[1] !== "emp") {
            const targetEmpId = parts[1];
            if (targetEmpId !== String(authUser.id) && targetEmpId !== authUser.openId) {
              return res.status(403).json({
                error: "Forbidden: You do not have permission to view another employee's evidence",
              });
            }
          }
        }
      }

      // Safe file path resolution under UPLOADS_DIR only
      const relativeSubpath = req.path.replace(/^\/uploads\/selfies\/?/, "");
      const normalized = path.normalize(relativeSubpath).replace(/^(\.\.[\/\\])+/, "");
      const fullPath = path.join(UPLOADS_DIR, normalized);

      if (!fullPath.startsWith(UPLOADS_DIR)) {
        return res.status(403).json({ error: "Forbidden: Invalid file path" });
      }

      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        return res.status(404).json({ error: "Evidence photo not found" });
      }

      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.sendFile(fullPath);
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403 || err?.statusCode === 401 || err?.statusCode === 403) {
        return res.status(err.status || err.statusCode || 401).json({
          error: err.message || "Unauthorized: Authentication required to view workforce evidence",
        });
      }
      return res.status(401).json({ error: "Unauthorized: Invalid or expired session token" });
    }
  });

  /**
   * REST API endpoint for uploading compressed selfies & visit evidence.
   * Derive employeeId strictly from the authenticated session (not request body).
   * Always requires authentication (unless ALLOW_INSECURE_DEV=true).
   */
  app.post("/api/upload-selfie", async (req: Request, res: Response) => {
    try {
      let sessionEmployeeId = "emp";
      const isDevBypass = process.env.ALLOW_INSECURE_DEV === "true";

      if (!isDevBypass) {
        const authUser = await sdk.authenticateRequest(req);
        // Authoritatively derive employeeId from authenticated session
        sessionEmployeeId = String(authUser.id);
      } else if (req.body?.employeeId) {
        sessionEmployeeId = String(req.body.employeeId);
      }

      const { base64, action } = req.body || {};
      if (!base64 || typeof base64 !== "string") {
        return res.status(400).json({ error: "Missing image base64 data" });
      }

      // Enforce 10MB maximum payload size
      if (base64.length > 14 * 1024 * 1024) {
        return res.status(413).json({ error: "Payload too large: Image exceeds 10MB maximum" });
      }

      // Validate image format (JPEG/PNG/WEBP only)
      const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");

      // Verify magic bytes: JPEG (ffd8ff), PNG (89504e47), WEBP (52494646)
      const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isPng = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      const isWebp = buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";

      if (!isJpeg && !isPng && !isWebp) {
        return res.status(415).json({ error: "Unsupported Media Type: Only JPEG, PNG, or WEBP images are accepted" });
      }

      const now = new Date();
      const year = now.getFullYear().toString();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const targetSubdir = path.join(UPLOADS_DIR, year, month);

      if (!fs.existsSync(targetSubdir)) {
        fs.mkdirSync(targetSubdir, { recursive: true });
      }

      // Sanitize action and employeeId to prevent path traversal
      const safeAction = (action || "selfie").replace(/[^a-zA-Z0-9_-]/g, "");
      const safeEmpId = sessionEmployeeId.replace(/[^a-zA-Z0-9_-]/g, "");
      const fileId = `${safeAction}-${safeEmpId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.jpg`;
      const filePath = path.join(targetSubdir, fileId);

      await fs.promises.writeFile(filePath, buffer);

      const relativeUrl = `/uploads/selfies/${year}/${month}/${fileId}`;
      const fileSizeKb = Math.round(buffer.length / 1024);

      return res.json({
        success: true,
        url: relativeUrl,
        sizeKb: fileSizeKb,
        retentionDays: RETENTION_DAYS,
      });
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403 || err?.statusCode === 401 || err?.statusCode === 403) {
        return res.status(err.status || err.statusCode || 401).json({ error: err.message || "Authentication required" });
      }
      console.error("[Selfie Storage] Upload failed:", err);
      return res.status(500).json({ error: "Failed to save selfie to server storage" });
    }
  });

  // Start 6-Month Retention Auto-Purge Cron
  scheduleRetentionPurge();
}

/**
 * Scans VM uploads directory and purges files older than 180 days (6 months)
 */
export function purgeOldSelfies(): { purgedCount: number; freedKb: number } {
  let purgedCount = 0;
  let freedBytes = 0;
  const now = Date.now();

  function scanAndPurge(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanAndPurge(fullPath);
        try {
          const remaining = fs.readdirSync(fullPath);
          if (remaining.length === 0) fs.rmdirSync(fullPath);
        } catch {}
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          const ageMs = now - stats.mtimeMs;

          if (ageMs > RETENTION_MS) {
            freedBytes += stats.size;
            fs.unlinkSync(fullPath);
            purgedCount++;
          }
        } catch (err) {
          console.warn(`[Selfie Purge] Failed checking ${fullPath}:`, err);
        }
      }
    }
  }

  scanAndPurge(UPLOADS_DIR);
  const freedKb = Math.round(freedBytes / 1024);
  return { purgedCount, freedKb };
}

function scheduleRetentionPurge() {
  setTimeout(() => purgeOldSelfies(), 10000);
  setInterval(() => {
    purgeOldSelfies();
  }, 24 * 60 * 60 * 1000);
}
