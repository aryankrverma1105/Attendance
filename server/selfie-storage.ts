import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "selfies");
const RETENTION_DAYS = 180; // 6 Months (approx 180 days)
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Ensure upload directories exist
export function initSelfieStorage(app: Express) {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // Serve static selfie uploads
  app.use("/uploads", (req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for fast admin loading
    next();
  }, (req, res, next) => {
    const staticMiddleware = require("express").static(path.join(process.cwd(), "uploads"));
    return staticMiddleware(req, res, next);
  });

  // REST API endpoint for uploading compressed selfies
  app.post("/api/upload-selfie", async (req: Request, res: Response) => {
    try {
      const { base64, action, employeeId } = req.body;
      if (!base64) {
        return res.status(400).json({ error: "Missing image base64 data" });
      }

      // Remove header if present (data:image/jpeg;base64,...)
      const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");

      const now = new Date();
      const year = now.getFullYear().toString();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const targetSubdir = path.join(UPLOADS_DIR, year, month);

      if (!fs.existsSync(targetSubdir)) {
        fs.mkdirSync(targetSubdir, { recursive: true });
      }

      const fileId = `${action || "selfie"}-${employeeId || "emp"}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.jpg`;
      const filePath = path.join(targetSubdir, fileId);

      await fs.promises.writeFile(filePath, buffer);

      const relativeUrl = `/uploads/selfies/${year}/${month}/${fileId}`;
      const fileSizeKb = Math.round(buffer.length / 1024);

      console.log(`[Selfie Storage] Saved ${fileId} (${fileSizeKb} KB) to VM instance`);

      return res.json({
        success: true,
        url: relativeUrl,
        sizeKb: fileSizeKb,
        retentionDays: RETENTION_DAYS,
      });
    } catch (err) {
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
        // Remove empty directories
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
            console.log(`[Selfie Purge] Deleted 6-month old selfie: ${entry.name}`);
          }
        } catch (err) {
          console.warn(`[Selfie Purge] Failed checking ${fullPath}:`, err);
        }
      }
    }
  }

  scanAndPurge(UPLOADS_DIR);
  const freedKb = Math.round(freedBytes / 1024);
  console.log(`[Selfie Retention] Purge complete. Removed ${purgedCount} photos older than 6 months (${freedKb} KB freed).`);
  return { purgedCount, freedKb };
}

/**
 * Runs the retention purge job every 24 hours
 */
function scheduleRetentionPurge() {
  // Run once at server launch
  setTimeout(() => purgeOldSelfies(), 10000);

  // Run every 24 hours
  setInterval(() => {
    purgeOldSelfies();
  }, 24 * 60 * 60 * 1000);
}
