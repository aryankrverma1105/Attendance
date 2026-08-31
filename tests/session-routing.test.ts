import { describe, expect, it } from "vitest";

import { getSessionRedirect } from "../lib/session-routing";

describe("FieldPulse session routing", () => {
  it("redirects a signed-out user to sign-in from protected app routes", () => {
    expect(getSessionRedirect({ hasSession: false, onLoginScreen: false })).toBe("/login");
  });

  it("keeps a signed-out user on the sign-in route", () => {
    expect(getSessionRedirect({ hasSession: false, onLoginScreen: true })).toBeNull();
  });

  it("redirects an authenticated user away from sign-in and leaves them on protected routes", () => {
    expect(getSessionRedirect({ hasSession: true, onLoginScreen: true })).toBe("/(tabs)");
    expect(getSessionRedirect({ hasSession: true, onLoginScreen: false })).toBeNull();
  });
});
