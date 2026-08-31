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
});
