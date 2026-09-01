import { describe, expect, it } from "vitest";

import { canAdminManageAccount, canRemoveManagedAccount } from "../lib/account-lifecycle";

describe("administrator account lifecycle policy", () => {
  it("allows account administration only for administrators", () => {
    expect(canAdminManageAccount("admin")).toBe(true);
    expect(canAdminManageAccount("manager")).toBe(false);
    expect(canAdminManageAccount("employee")).toBe(false);
  });

  it("prevents an administrator from deleting their own account", () => {
    expect(canRemoveManagedAccount({ role: "admin", actorId: "admin-1", targetUserId: "employee-1" })).toBe(true);
    expect(canRemoveManagedAccount({ role: "admin", actorId: "admin-1", targetUserId: "admin-1" })).toBe(false);
  });

  it("enforces that ONLY the primary Super Admin (9835916278) can remove other administrators", () => {
    // Non-super admin trying to remove another admin -> FALSE
    expect(
      canRemoveManagedAccount({
        role: "admin",
        actorId: "admin-secondary",
        actorIdentifier: "+919999999999",
        targetUserId: "admin-other",
        targetUserRole: "admin",
        targetUserIdentifier: "+918888888888",
      })
    ).toBe(false);

    // Primary Super Admin (9835916278) removing another admin -> TRUE
    expect(
      canRemoveManagedAccount({
        role: "admin",
        actorId: "admin-super",
        actorIdentifier: "+919835916278",
        targetUserId: "admin-other",
        targetUserRole: "admin",
        targetUserIdentifier: "+918888888888",
      })
    ).toBe(true);

    // Nobody can remove the primary Super Admin (9835916278)
    expect(
      canRemoveManagedAccount({
        role: "admin",
        actorId: "admin-other",
        actorIdentifier: "+918888888888",
        targetUserId: "admin-super",
        targetUserRole: "admin",
        targetUserIdentifier: "+919835916278",
      })
    ).toBe(false);
  });
});
