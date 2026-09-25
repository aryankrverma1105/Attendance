import { describe, it, expect, vi } from "vitest";

(globalThis as any).__DEV__ = true;

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Linking: { openURL: vi.fn(), addEventListener: vi.fn() },
}));

vi.mock("expo-location", () => ({}));
vi.mock("@/lib/tracking-service", () => ({
  startManagedRouteTracking: vi.fn(),
  stopManagedRouteTracking: vi.fn(),
}));
vi.mock("../lib/tracking-service", () => ({
  startManagedRouteTracking: vi.fn(),
  stopManagedRouteTracking: vi.fn(),
}));
vi.mock("expo-linking", () => ({ createURL: vi.fn(), addEventListener: vi.fn() }));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-modules-core", () => ({
  EventEmitter: class {},
  LegacyEventEmitter: class {},
  NativeModulesProxy: {},
  requireNativeModule: vi.fn(),
  requireOptionalNativeModule: vi.fn(),
  Platform: { OS: "ios" },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock("@/lib/_core/auth", () => ({
  getSessionToken: vi.fn(async () => null),
  getUserInfo: vi.fn(async () => null),
}));

vi.mock("@/lib/trpc", () => ({
  trpcClient: {
    tasks: {
      listAllTasks: {
        query: vi.fn(async () => [
          {
            id: "task-1",
            title: "Solar inverter check",
            assignedToUserId: 101,
            assignedByUserId: 1,
            scheduledDate: "2026-09-21",
            priority: "HIGH",
            status: "PENDING", // stale server copy
            createdAt: "2026-09-21T08:00:00.000Z",
            updatedAt: "2026-09-21T08:00:00.000Z",
          },
        ]),
      },
      create: { mutate: vi.fn() },
      updateStatus: { mutate: vi.fn() },
    },
    customers: {
      list: { query: vi.fn(async () => []) },
      create: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
    },
    visits: {
      list: { query: vi.fn(async () => []) },
      create: { mutate: vi.fn() },
      checkIn: { mutate: vi.fn() },
      complete: { mutate: vi.fn() },
      updateNotes: { mutate: vi.fn() },
      addEvidence: { mutate: vi.fn() },
    },
    attendance: {
      getHistory: { query: vi.fn(async () => []) },
      checkIn: { mutate: vi.fn() },
      checkOut: { mutate: vi.fn() },
    },
  },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => JSON.stringify([
      {
        operationId: "op_task_update_1",
        type: "TASK_UPDATE",
        payload: { taskId: "task-1", status: "COMPLETED" },
        status: "queued",
      },
    ])),
    setItem: vi.fn(async () => {}),
  },
}));

import { hydrateFromServer } from "../lib/field-data";
import type { FieldWorkspace, FieldSession } from "../lib/field-types";

describe("Hydration Offline Protection Tests (BUG 1)", () => {
  const session: FieldSession = {
    id: "101",
    identifier: "+919876543210",
    displayName: "Technician Alex",
    role: "employee",
    isPreview: false,
    signedInAt: new Date().toISOString(),
  };

  it("fails on unpatched code: offline pending task status change is silently overwritten by stale server copy", async () => {
    // 1. Local workspace has task-1 updated offline to COMPLETED with syncState: "awaiting-server"
    const localWorkspace: FieldWorkspace = {
      session,
      managedUsers: [],
      accountEvents: [],
      attendance: [],
      tasks: [
        {
          id: "task-1",
          title: "Solar inverter check",
          assignedToUserId: "101",
          assignedByUserId: "1",
          scheduledDate: "2026-09-21",
          priority: "HIGH",
          status: "COMPLETED", // changed locally while offline
          createdAt: "2026-09-21T08:00:00.000Z",
          updatedAt: "2026-09-21T10:00:00.000Z",
          syncState: "awaiting-server" as any,
        },
      ],
      customers: [],
      visits: [],
      messages: [],
      routePoints: [],
      offlineQueue: [],
      trackingPermissionAlerts: [],
      trackingActive: false,
      trackingMode: "idle",
      notificationsEnabled: true,
    };

    // 2. Hydrate from server (where server returns status: "PENDING")
    const updates = await hydrateFromServer(localWorkspace, session);

    // On unpatched code, this assertion FAILS because stale server status "PENDING" overwrites local "COMPLETED"
    const updatedTask = updates.tasks?.find((t) => t.id === "task-1");
    expect(updatedTask?.status).toBe("COMPLETED");
  });
});
