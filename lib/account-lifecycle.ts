import type { FieldRole } from "@/lib/field-types";

export function canAdminManageAccount(role?: FieldRole) {
  return role === "admin";
}

export function canRemoveManagedAccount(input: { role?: FieldRole; actorId?: string; targetUserId: string }) {
  return canAdminManageAccount(input.role) && Boolean(input.actorId) && input.actorId !== input.targetUserId;
}
