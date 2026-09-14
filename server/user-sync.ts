/**
 * DEPRECATED & REMOVED: Unauthenticated REST user management routes (/api/users, /api/users/check, /api/users/sync).
 * User management is strictly handled through authenticated tRPC procedures in `workforce` router
 * backed directly by the Drizzle `users` database table as the single source of truth.
 */
import type { Express } from "express";

export function initUserSync(_app: Express) {
  // All unauthenticated REST routes and on-disk JSON stores have been removed for security.
}
