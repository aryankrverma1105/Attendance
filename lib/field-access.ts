import type { FieldRole } from "@/lib/field-types";

// ==========================================
// CENTRALIZED PERMISSION MATRIX
// ==========================================

export type AppPermission =
  // User Management
  | "users.read.all"
  | "users.create"
  | "users.update"
  | "users.suspend"
  | "users.pause"
  | "users.reactivate"
  | "users.deactivate"
  | "users.setWage"
  // Team Management
  | "team.read.own"
  // Task Management
  | "tasks.read.all"
  | "tasks.read.ownTeam"
  | "tasks.read.self"
  | "tasks.create"
  | "tasks.assign.all"
  | "tasks.assign.ownTeam"
  | "tasks.update.all"
  | "tasks.update.ownTeam"
  | "tasks.update.self"
  // Customers & Map
  | "customers.read"
  | "customers.create"
  | "customers.update"
  | "map.read.ownTeam"
  // Reports & Analytics
  | "reports.read.all"
  | "reports.read.ownTeam"
  | "reports.read.self"
  // GPS & Route History
  | "routes.read.all"
  | "routes.read.ownTeam"
  | "routes.read.self"
  // Audit & Settings
  | "audit.read"
  | "settings.manage"
  // Employee Field Operations
  | "profile.read.self"
  | "attendance.read.self"
  | "attendance.create.self"
  | "attendance.checkout.self"
  | "visits.read.self"
  | "visits.create.self"
  | "visits.update.self"
  | "tracking.create.self"
  | "tracking.read.self";

export const ROLE_PERMISSIONS: Record<FieldRole, ReadonlySet<AppPermission>> = {
  admin: new Set<AppPermission>([
    "users.read.all",
    "users.create",
    "users.update",
    "users.suspend",
    "users.pause",
    "users.reactivate",
    "users.deactivate",
    "users.setWage",
    "team.read.own",
    "tasks.read.all",
    "tasks.create",
    "tasks.assign.all",
    "tasks.update.all",
    "customers.read",
    "customers.create",
    "customers.update",
    "map.read.ownTeam",
    "reports.read.all",
    "routes.read.all",
    "audit.read",
    "settings.manage",
    "profile.read.self",
  ]),

  manager: new Set<AppPermission>([
    "team.read.own",
    "tasks.read.ownTeam",
    "tasks.create",
    "tasks.assign.ownTeam",
    "tasks.update.ownTeam",
    "customers.read",
    "customers.create",
    "customers.update",
    "map.read.ownTeam",
    "reports.read.ownTeam",
    "routes.read.ownTeam",
    "profile.read.self",
  ]),

  employee: new Set<AppPermission>([
    "profile.read.self",
    "attendance.read.self",
    "attendance.create.self",
    "attendance.checkout.self",
    "tasks.read.self",
    "tasks.update.self",
    "visits.read.self",
    "visits.create.self",
    "visits.update.self",
    "tracking.create.self",
    "tracking.read.self",
    "routes.read.self",
    "reports.read.self",
  ]),
};

/**
 * Check if a role statically possesses a given permission.
 */
export function hasPermission(role: FieldRole | undefined, permission: AppPermission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/**
 * Check contextual authorization evaluating actor identity, target team scoping, and context.
 */
export function canPerformAction(
  actor: { role?: FieldRole; id?: string },
  permission: AppPermission,
  context?: {
    targetUserId?: string;
    targetUserRole?: FieldRole;
    targetManagerId?: string;
    assignedToUserId?: string;
  }
): boolean {
  if (!actor.role) return false;

  // 1. Check static role permission matrix first
  if (!hasPermission(actor.role, permission)) {
    return false;
  }

  // 2. Contextual evaluation
  if (actor.role === "admin") {
    // Admin has unrestricted scope across organization
    return true;
  }

  if (actor.role === "manager") {
    // Manager is scoped strictly to their own team members
    if (permission === "tasks.assign.ownTeam" || permission === "routes.read.ownTeam" || permission === "tasks.update.ownTeam") {
      if (context?.targetManagerId && context.targetManagerId !== actor.id) {
        return false;
      }
    }
    return true;
  }

  if (actor.role === "employee") {
    // Employee is scoped strictly to self
    if (context?.targetUserId && context.targetUserId !== actor.id) {
      return false;
    }
    if (context?.assignedToUserId && context.assignedToUserId !== actor.id) {
      return false;
    }
    return true;
  }

  return false;
}

// ==========================================
// CONVENIENCE SCOPED EVALUATION HELPERS
// ==========================================

export function canManageWorkforce(role?: FieldRole) {
  return hasPermission(role, "users.read.all");
}

export function canAccessAdminDashboard(role?: FieldRole) {
  return role === "admin";
}

export function canAccessManagerDashboard(role?: FieldRole) {
  return role === "admin" || role === "manager";
}

export function canViewTeamActivity(role?: FieldRole) {
  return role === "admin" || role === "manager";
}

export function canViewEmployeeRecord(input: {
  viewerRole?: FieldRole;
  viewerId?: string;
  employeeId: string;
  targetManagerId?: string;
}) {
  if (input.viewerRole === "admin") return true;
  if (input.viewerId === input.employeeId) return true;
  if (input.viewerRole === "manager" && input.targetManagerId === input.viewerId) return true;
  return false;
}

export function canSetEmployeeWage(input: {
  actorRole?: FieldRole;
  actorId?: string;
  targetUserId: string;
  targetUserRole?: FieldRole;
  targetManagerId?: string;
}) {
  return hasPermission(input.actorRole, "users.setWage");
}

export function canParticipateInAttendance(role?: FieldRole) {
  return hasPermission(role, "attendance.create.self");
}

export function canAssignTasks(role?: FieldRole) {
  return hasPermission(role, "tasks.create");
}

export function canAssignTaskToWorker(input: {
  actorRole?: FieldRole;
  actorId?: string;
  targetUserRole?: FieldRole;
  targetManagerId?: string;
}) {
  if (input.targetUserRole !== "employee") return false;
  return canPerformAction(
    { role: input.actorRole, id: input.actorId },
    input.actorRole === "admin" ? "tasks.assign.all" : "tasks.assign.ownTeam",
    { targetManagerId: input.targetManagerId }
  );
}

export function canUpdateTaskStatus(input: {
  actorRole?: FieldRole;
  actorId?: string;
  assignedToUserId: string;
}) {
  return canPerformAction(
    { role: input.actorRole, id: input.actorId },
    input.actorRole === "employee" ? "tasks.update.self" : input.actorRole === "manager" ? "tasks.update.ownTeam" : "tasks.update.all",
    { assignedToUserId: input.assignedToUserId }
  );
}

export function canViewGpsHistory(input: {
  viewerRole?: FieldRole;
  viewerId?: string;
  targetUserId: string;
  targetManagerId?: string;
}) {
  return canPerformAction(
    { role: input.viewerRole, id: input.viewerId },
    input.viewerRole === "admin" ? "routes.read.all" : input.viewerRole === "manager" ? "routes.read.ownTeam" : "routes.read.self",
    { targetUserId: input.targetUserId, targetManagerId: input.targetManagerId }
  );
}

export function canCreateUsers(role?: FieldRole) {
  return hasPermission(role, "users.create");
}

export function canViewEmployeeEarnings(input: {
  actorRole?: FieldRole;
  actorId?: string;
  targetUserId: string;
  targetManagerId?: string;
}) {
  if (input.actorRole === "admin") return true;
  if (input.actorId === input.targetUserId) return true;
  if (input.actorRole === "manager" && input.targetManagerId === input.actorId) return true;
  return false;
}
