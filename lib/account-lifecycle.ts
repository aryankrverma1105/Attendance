import type { FieldRole } from "@/lib/field-types";

export function isSuperAdmin(identifier?: string) {
  if (!identifier) return false;
  const digits = identifier.replace(/[^0-9]/g, "");
  return digits.includes("9835916278");
}

export function canAdminManageAccount(role?: FieldRole) {
  return role === "admin";
}

export function canRemoveManagedAccount(input: {
  role?: FieldRole;
  actorId?: string;
  actorIdentifier?: string;
  targetUserId: string;
  targetUserRole?: FieldRole;
  targetUserIdentifier?: string;
}) {
  if (!canAdminManageAccount(input.role) || !input.actorId) return false;
  if (input.actorId === input.targetUserId) return false;

  // Primary Super Admin (9835916278) can never be removed or deleted by anyone
  if (isSuperAdmin(input.targetUserIdentifier)) {
    return false;
  }

  // If the target is an Administrator, ONLY the primary Super Admin (9835916278) can remove them
  if (input.targetUserRole === "admin") {
    return isSuperAdmin(input.actorIdentifier);
  }

  return true;
}
