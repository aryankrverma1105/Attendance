import type { FieldRole } from "@/lib/field-types";

export function canManageWorkforce(role?: FieldRole) {
  return role === "admin";
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
  // STRICT RULE: Only Admin can modify employee daily wages.
  // Managers and Employees are strictly denied.
  return input.actorRole === "admin";
}

export function canParticipateInAttendance(role?: FieldRole) {
  // Only field employees participate in attendance check-in/out.
  // Admin and Manager are salaried management and do not check in.
  return role === "employee";
}

export function canAssignTasks(role?: FieldRole) {
  return role === "admin" || role === "manager";
}

export function canAssignTaskToWorker(input: {
  actorRole?: FieldRole;
  actorId?: string;
  targetUserRole?: FieldRole;
  targetManagerId?: string;
}) {
  if (input.targetUserRole !== "employee") return false;
  if (input.actorRole === "admin") return true;
  if (input.actorRole === "manager") {
    return input.targetManagerId === input.actorId;
  }
  return false;
}

export function canUpdateTaskStatus(input: {
  actorRole?: FieldRole;
  actorId?: string;
  assignedToUserId: string;
}) {
  if (input.actorRole === "admin" || input.actorRole === "manager") return true;
  if (input.actorRole === "employee") {
    return input.actorId === input.assignedToUserId;
  }
  return false;
}

export function canViewGpsHistory(input: {
  viewerRole?: FieldRole;
  viewerId?: string;
  targetUserId: string;
  targetManagerId?: string;
}) {
  if (input.viewerRole === "admin") return true;
  if (input.viewerId === input.targetUserId) return true;
  if (input.viewerRole === "manager" && input.targetManagerId === input.viewerId) return true;
  return false;
}

export function canCreateUsers(role?: FieldRole) {
  return role === "admin";
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
