import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type {
  AccountLifecycleEvent,
  AttendanceRecord,
  ChatMessage,
  Customer,
  FieldRole,
  FieldSession,
  FieldWorkspace,
  LocationEvidence,
  ManagedUser,
  OfflineOperation,
  RoutePoint,
  TrackingPermissionAlert,
  Visit,
} from "@/lib/field-types";
import {
  calculateEarnings,
  calculateWorkedDays,
  calculateWorkingDaysInMonth,
  classifyLocationEvidence,
  formatCurrency,
  getMonthlyWorkedDaysBreakdown,
  routeDistanceKm,
} from "@/lib/field-math";
import { canAdminManageAccount, canRemoveManagedAccount } from "@/lib/account-lifecycle";
import { canSetEmployeeWage } from "@/lib/field-access";
import { startManagedRouteTracking, stopManagedRouteTracking, type TrackingStartResult } from "@/lib/tracking-service";
import { shouldStartTrackingAfterAttendance } from "@/lib/tracking-policy";
import { shouldEscalateTrackingPermission } from "@/lib/tracking-feedback";
import { getApiBaseUrl } from "@/constants/oauth";

export {
  calculateEarnings,
  calculateWorkedDays,
  calculateWorkingDaysInMonth,
  formatCurrency,
  getMonthlyWorkedDaysBreakdown,
  routeDistanceKm,
} from "@/lib/field-math";

const FIELD_WORKSPACE_KEY = "fieldpulse.workspace.v1";
const FIELD_SESSION_KEY = "fieldpulse.session.v1";

const emptyWorkspace: FieldWorkspace = {
  session: null,
  managedUsers: [],
  accountEvents: [],
  attendance: [],
  tasks: [],
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

type AttendanceCaptureInput = {
  action: "check-in" | "check-out";
  photoUri: string;
  location: LocationEvidence;
};

export type AttendanceCaptureResult = {
  action: AttendanceCaptureInput["action"];
  tracking?: TrackingStartResult;
  trackingStopped: boolean;
};

type VisitCaptureInput = AttendanceCaptureInput & {
  visitId: string;
};

type FieldDataContextValue = {
  data: FieldWorkspace;
  isHydrated: boolean;
  signInToPreview: (identifier: string, role?: FieldSession["role"], displayName?: string) => void;
  setServerSession: (serverUser: any, token?: string) => void;
  signOut: () => void;
  createManagedUser: (input: Omit<ManagedUser, "id" | "accountLinkId" | "status" | "createdAt" | "accessIssuedAt">) => Promise<string>;
  issueManagedUserAccess: (userId: string) => boolean;
  removeManagedUser: (userId: string) => Promise<boolean>;
  updateManagedUser: (userId: string, updates: Partial<Omit<ManagedUser, "id" | "createdAt">>) => Promise<boolean>;
  updateEmployeeWage: (userId: string, newDailyWage: number) => Promise<boolean>;
  createTask: (input: {
    title: string;
    description?: string;
    assignedToUserId: string;
    assignedToName?: string;
    scheduledDate: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    locationAddress?: string;
    customerName?: string;
  }) => Promise<string>;
  updateTaskStatus: (taskId: string, newStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED") => Promise<void>;
  captureAttendance: (input: AttendanceCaptureInput) => Promise<AttendanceCaptureResult>;
  captureVisitEvidence: (input: VisitCaptureInput) => void;
  addCustomer: (input: Omit<Customer, "id" | "createdAt">) => string;
  createVisit: (input: Omit<Visit, "id" | "status" | "checkInAt" | "checkOutAt" | "checkInLocation" | "checkOutLocation" | "evidenceUris" | "meetingOutcome" | "notes" | "followUpDate">) => string;
  updateVisit: (visitId: string, input: Pick<Visit, "meetingOutcome" | "notes" | "followUpDate">) => void;
  sendMessage: (text: string) => void;
  addRoutePoint: (point: LocationEvidence) => Promise<void> | void;
  startRouteTracking: () => Promise<TrackingStartResult>;
  stopRouteTracking: () => Promise<void>;
  setTrackingActive: (active: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
};

const FieldDataContext = createContext<FieldDataContextValue | null>(null);

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function queueOperation(
  category: OfflineOperation["category"],
  title: string,
): OfflineOperation {
  return {
    id: createId("operation"),
    category,
    title,
    createdAt: new Date().toISOString(),
    status: "awaiting-server",
  };
}

function verificationStatus(location: LocationEvidence): AttendanceRecord["status"] {
  return classifyLocationEvidence(location);
}

function normalizeIdentifier(id: string): string {
  const digits = id.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10 && digits.startsWith("91")) return `+${digits}`;
  return id.trim().toLowerCase();
}

function buildPreviewSession(
  identifier: string,
  selectedRole?: FieldSession["role"],
  customDisplayName?: string,
): FieldSession {
  const trimmedIdentifier = identifier.trim();
  const digits = trimmedIdentifier.replace(/[^0-9]/g, "");
  const isSuperAdminUser = digits.includes("9835916278");
  const isAdmin = isSuperAdminUser || trimmedIdentifier.toLowerCase().includes("admin") || selectedRole === "admin";
  const isManager = !isAdmin && (trimmedIdentifier.toLowerCase().includes("manager") || selectedRole === "manager");
  
  let displayName = customDisplayName;
  if (!displayName || displayName === "Field employee" || displayName === "Field Employee") {
    if (isSuperAdminUser) displayName = "Aryan Kumar Verma";
    else if (trimmedIdentifier.includes("@")) displayName = trimmedIdentifier.split("@")[0];
    else displayName = isAdmin ? "Administrator" : isManager ? "Field Manager" : "Technician";
  }

  const inferredRole: FieldSession["role"] = isAdmin ? "admin" : isManager ? "manager" : "employee";
  const normalizedId = digits.length === 10 ? `+91${digits}` : trimmedIdentifier;

  return {
    id: createId("preview-user"),
    identifier: normalizedId,
    displayName: displayName,
    role: selectedRole ?? inferredRole,
    isPreview: true,
    signedInAt: new Date().toISOString(),
  };
}

export async function syncUsersWithServer(): Promise<ManagedUser[] | null> {
  try {
    const { trpcClient } = require("@/lib/trpc");
    const serverUsers = await trpcClient.workforce.listUsers.query();
    if (Array.isArray(serverUsers)) {
      return serverUsers.map((su: any) => ({
        id: String(su.id),
        accountLinkId: `account-${su.id}`,
        displayName: su.name || su.phoneE164 || "Field Worker",
        identifier: su.phoneE164 || su.openId,
        role: su.role === "admin" ? "admin" : su.role === "manager" ? "manager" : "employee",
        status: su.accountStatus === "active" ? "active" : su.accountStatus === "invited" ? "invited" : "suspended",
        dailyWage: su.dailyWage ?? 0,
        managerId: su.managerId ? String(su.managerId) : undefined,
        createdAt: su.createdAt ? new Date(su.createdAt).toISOString() : new Date().toISOString(),
      }));
    }
  } catch (err) {
    // Expected if not authenticated or caller is employee
  }
  return null;
}

const persistWorkspaceToStorage = (workspace: Partial<FieldWorkspace>) => {
  const { session, ...rest } = workspace;
  AsyncStorage.setItem(FIELD_WORKSPACE_KEY, JSON.stringify(rest)).catch((e) =>
    console.error("[Storage] Failed to save workspace:", e)
  );
};

export function FieldDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FieldWorkspace>(emptyWorkspace);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    const hydrationFallback = setTimeout(() => {
      if (active) setIsHydrated(true);
    }, 900);

    AsyncStorage.getItem(FIELD_WORKSPACE_KEY)
      .then((workspaceValue) => {
        if (!active) return;
        const parsedWorkspace = workspaceValue ? (JSON.parse(workspaceValue) as Partial<FieldWorkspace>) : {};
        
        // Auto-deduplicate users by normalized phone/email
        const rawUsers = parsedWorkspace.managedUsers || [];
        const seen = new Set<string>();
        const dedupedUsers: ManagedUser[] = [];
        for (const u of rawUsers) {
          const key = normalizeIdentifier(u.identifier);
          if (!seen.has(key)) {
            seen.add(key);
            const isAdm = key.includes("9835916278");
            dedupedUsers.push({
              ...u,
              identifier: key.startsWith("+91") ? key : u.identifier,
              displayName: isAdm && (u.displayName === "Field employee" || !u.displayName) ? "Aryan Kumar Verma" : u.displayName,
            });
          }
        }

        // Always ensure Super Admin account is present
        if (!seen.has("+919835916278")) {
          dedupedUsers.unshift({
            id: "admin-sologix-primary",
            accountLinkId: "account-admin-sologix",
            displayName: "Aryan Kumar Verma",
            identifier: "+919835916278",
            role: "admin",
            status: "active",
            dailyWage: 0,
            createdAt: new Date().toISOString(),
          });
        }

        setData((current) => {
          const mergedUsers = dedupedUsers.length > 0 ? dedupedUsers : current.managedUsers;
          return {
            ...emptyWorkspace,
            ...parsedWorkspace,
            managedUsers: mergedUsers,
            session: null, // Require login on app launch
          };
        });

        // Background server sync: fetch all accounts from VM server across all devices
        syncUsersWithServer()
          .then((serverUsers) => {
            if (!active || !serverUsers || serverUsers.length === 0) return;
            setData((prev) => {
              const combined = [...prev.managedUsers];
              for (const su of serverUsers) {
                const suKey = normalizeIdentifier(su.identifier);
                const idx = combined.findIndex((u) => normalizeIdentifier(u.identifier) === suKey);
                if (idx >= 0) {
                  combined[idx] = { ...combined[idx], ...su };
                } else {
                  combined.push(su);
                }
              }
              const updated = { ...prev, managedUsers: combined };
              persistWorkspaceToStorage(updated);
              return updated;
            });
          })
          .catch(() => {});
      })
      .catch((err) => {
        console.error("[Storage] Hydration error:", err);
      })
      .finally(() => {
        clearTimeout(hydrationFallback);
        if (active) setIsHydrated(true);
      });

    try {
      const { initOfflineAutoSync } = require("@/lib/offline-sync");
      initOfflineAutoSync();
    } catch {}

    return () => {
      active = false;
      clearTimeout(hydrationFallback);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    persistWorkspaceToStorage(data);
  }, [data, isHydrated]);

  const signInToPreview = useCallback((identifier: string, role?: FieldSession["role"], customDisplayName?: string) => {
    const normalizedKey = normalizeIdentifier(identifier);
    let resolvedName = customDisplayName;
    let resolvedRole = role;

    setData((current) => {
      const cleanInput = identifier.trim().toLowerCase();
      const inputDigits = cleanInput.replace(/[^0-9]/g, "");
      const inputLast10 = inputDigits.length >= 10 ? inputDigits.slice(-10) : inputDigits;

      // Find user by normalized key, 10-digit phone match, or name
      const existingUser = current.managedUsers.find((user) => {
        const uId = normalizeIdentifier(user.identifier);
        const uDigits = (user.identifier || "").replace(/[^0-9]/g, "");
        const uLast10 = uDigits.length >= 10 ? uDigits.slice(-10) : uDigits;
        const uName = (user.displayName || "").toLowerCase().trim();

        return (
          uId === normalizedKey ||
          (inputLast10 && uLast10 && inputLast10 === uLast10) ||
          (cleanInput && uName === cleanInput) ||
          (cleanInput && user.identifier.toLowerCase() === cleanInput)
        );
      });

      if (existingUser) {
        resolvedName = existingUser.displayName;
        resolvedRole = existingUser.role; // Always preserve assigned role (admin/manager/employee)
      }

      const session = buildPreviewSession(identifier, resolvedRole, resolvedName);
      const workspaceUser: ManagedUser = {
        id: existingUser ? existingUser.id : session.id,
        accountLinkId: existingUser ? existingUser.accountLinkId : `account-${session.id}`,
        displayName: resolvedName || session.displayName,
        identifier: existingUser ? existingUser.identifier : session.identifier,
        role: existingUser ? existingUser.role : (resolvedRole || session.role),
        status: existingUser ? existingUser.status : "active",
        dailyWage: existingUser ? existingUser.dailyWage : 0,
        createdAt: existingUser ? existingUser.createdAt : session.signedInAt,
      };

      const updatedUsers = existingUser
        ? current.managedUsers.map((user) =>
            user.id === existingUser.id
              ? { ...user, displayName: workspaceUser.displayName, role: workspaceUser.role }
              : user
          )
        : [workspaceUser, ...current.managedUsers];

      const nextWorkspace: FieldWorkspace = {
        ...current,
        session,
        managedUsers: updatedUsers,
      };

      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });
  }, []);

  const setServerSession = useCallback((serverUser: {
    id: number;
    openId: string;
    name?: string | null;
    phoneE164?: string | null;
    role: "admin" | "manager" | "employee" | "user";
    dailyWage?: number;
    managerId?: number | null;
    accountStatus?: string;
  }) => {
    const role: FieldRole =
      serverUser.role === "admin"
        ? "admin"
        : serverUser.role === "manager"
        ? "manager"
        : "employee";

    const session: FieldSession = {
      id: String(serverUser.id),
      numericId: serverUser.id,
      identifier: serverUser.phoneE164 || serverUser.openId,
      displayName: serverUser.name || (serverUser.phoneE164 ? serverUser.phoneE164 : "Field User"),
      role,
      isPreview: false,
      signedInAt: new Date().toISOString(),
      dailyWage: serverUser.dailyWage ?? 0,
      managerId: serverUser.managerId ? String(serverUser.managerId) : undefined,
      accountStatus: serverUser.accountStatus,
    };

    setData((current) => {
      const exists = current.managedUsers.find(
        (u) => u.id === String(serverUser.id) || normalizeIdentifier(u.identifier) === normalizeIdentifier(session.identifier)
      );
      const updatedUser: ManagedUser = {
        id: String(serverUser.id),
        accountLinkId: `account-${serverUser.id}`,
        displayName: session.displayName,
        identifier: session.identifier,
        role: session.role,
        status: (serverUser.accountStatus as any) || "active",
        dailyWage: session.dailyWage ?? 0,
        managerId: session.managerId,
        createdAt: exists ? exists.createdAt : new Date().toISOString(),
      };

      const updatedUsers = exists
        ? current.managedUsers.map((u) => (u.id === exists.id ? { ...u, ...updatedUser } : u))
        : [updatedUser, ...current.managedUsers];

      const nextWorkspace: FieldWorkspace = {
        ...current,
        session,
        managedUsers: updatedUsers,
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });
  }, []);

  const signOut = useCallback(() => {
    stopManagedRouteTracking().catch(() => undefined);
    setData((current) => ({ ...current, session: null, trackingActive: false, trackingMode: "idle" }));
    if (Platform.OS === "web") {
      if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(FIELD_SESSION_KEY);
      if (typeof localStorage !== "undefined") localStorage.removeItem(FIELD_SESSION_KEY);
    }
    SecureStore.deleteItemAsync(FIELD_SESSION_KEY).catch(() => undefined);
    try {
      const { removeSessionToken, clearUserInfo } = require("@/lib/_core/auth");
      removeSessionToken().catch(() => undefined);
      if (clearUserInfo) clearUserInfo().catch(() => undefined);
    } catch {}
  }, []);

  const createManagedUser = useCallback(async (input: Omit<ManagedUser, "id" | "accountLinkId" | "status" | "createdAt" | "accessIssuedAt">) => {
    let cleanPhone = input.identifier.trim();
    if (/^\d{10}$/.test(cleanPhone)) cleanPhone = `+91${cleanPhone}`;
    else if (!cleanPhone.startsWith("+")) cleanPhone = `+${cleanPhone}`;

    const { trpcClient } = require("@/lib/trpc");
    const result = await trpcClient.workforce.createUser.mutate({
      name: input.displayName.trim(),
      phoneE164: cleanPhone,
      role: input.role === "admin" ? "admin" : input.role === "manager" ? "manager" : "employee",
      department: input.department,
      dailyWage: input.dailyWage,
      managerId: input.managerId ? parseInt(input.managerId, 10) : undefined,
    });

    const serverUser = result.user;
    const user: ManagedUser = {
      id: String(serverUser.id),
      accountLinkId: `account-${serverUser.id}`,
      displayName: serverUser.name || input.displayName,
      identifier: serverUser.phoneE164 || cleanPhone,
      role: (serverUser.role === "admin" ? "admin" : serverUser.role === "manager" ? "manager" : "employee") as FieldRole,
      status: "active",
      department: input.department,
      dailyWage: serverUser.dailyWage,
      managerId: serverUser.managerId ? String(serverUser.managerId) : undefined,
      createdAt: new Date(serverUser.createdAt).toISOString(),
    };

    const createdAt = new Date().toISOString();
    const event: AccountLifecycleEvent = {
      id: createId("account-event"),
      userId: user.id,
      accountLinkId: user.accountLinkId,
      action: "account-created",
      performedById: data.session?.id,
      occurredAt: createdAt,
      detail: "Linked account created and registered on server.",
    };

    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: [user, ...current.managedUsers.filter((u) => u.id !== user.id)],
        accountEvents: [event, ...current.accountEvents],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });

    return user.id;
  }, [data.session?.id]);

  const issueManagedUserAccess = useCallback((userId: string) => {
    const target = data.managedUsers.find((user) => user.id === userId);
    if (!target || !canAdminManageAccount(data.session?.role)) return false;
    const issuedAt = new Date().toISOString();
    const event: AccountLifecycleEvent = {
      id: createId("account-event"),
      userId,
      accountLinkId: target.accountLinkId,
      action: "access-issued",
      performedById: data.session?.id,
      occurredAt: issuedAt,
      detail: "Account access invitation issued.",
    };
    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: current.managedUsers.map((user) =>
          user.id === userId ? { ...user, status: "active" as const, accessIssuedAt: issuedAt } : user
        ),
        accountEvents: [event, ...current.accountEvents],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });
    return true;
  }, [data.managedUsers, data.session?.id, data.session?.role]);

  const removeManagedUser = useCallback(async (userId: string) => {
    const target = data.managedUsers.find((user) => user.id === userId);
    if (
      !target ||
      !canRemoveManagedAccount({
        role: data.session?.role,
        actorId: data.session?.id,
        actorIdentifier: data.session?.identifier,
        targetUserId: userId,
        targetUserRole: target.role,
        targetUserIdentifier: target.identifier,
      })
    )
      return false;

    const numericUserId = parseInt(userId, 10);
    if (!isNaN(numericUserId)) {
      const { trpcClient } = require("@/lib/trpc");
      await trpcClient.workforce.updateUserStatus.mutate({
        targetUserId: numericUserId,
        accountStatus: "suspended",
      });
    }

    const removedAt = new Date().toISOString();
    const event: AccountLifecycleEvent = {
      id: createId("account-event"),
      userId,
      accountLinkId: target.accountLinkId,
      action: "account-removed",
      performedById: data.session?.id,
      occurredAt: removedAt,
      detail: "Linked account suspended on server directory.",
    };

    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: current.managedUsers.filter((user) => user.id !== userId),
        accountEvents: [event, ...current.accountEvents],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });

    return true;
  }, [data.managedUsers, data.session?.id, data.session?.identifier, data.session?.role]);

  const updateManagedUser = useCallback(async (userId: string, updates: Partial<Omit<ManagedUser, "id" | "createdAt">>) => {
    if (!canAdminManageAccount(data.session?.role)) return false;
    const target = data.managedUsers.find((user) => user.id === userId);
    if (!target) return false;

    let cleanPhone = updates.identifier !== undefined ? updates.identifier.trim() : target.identifier;
    if (cleanPhone) {
      if (/^\d{10}$/.test(cleanPhone)) cleanPhone = `+91${cleanPhone}`;
      else if (!cleanPhone.startsWith("+") && /^\d+$/.test(cleanPhone)) cleanPhone = `+${cleanPhone}`;
    }

    const validatedWage = updates.dailyWage !== undefined
      ? Math.max(0, Math.min(100000, Math.round(updates.dailyWage || 0)))
      : target.dailyWage;

    const numericUserId = parseInt(userId, 10);
    if (!isNaN(numericUserId)) {
      const { trpcClient } = require("@/lib/trpc");
      if (updates.role || updates.status || updates.managerId !== undefined) {
        await trpcClient.workforce.updateUserStatus.mutate({
          targetUserId: numericUserId,
          role: updates.role ? (updates.role as any) : undefined,
          accountStatus: updates.status ? (updates.status as any) : undefined,
          managerId: updates.managerId ? parseInt(updates.managerId, 10) : updates.managerId === null ? null : undefined,
        });
      }
      if (updates.dailyWage !== undefined && (updates.role === "employee" || (!updates.role && target.role === "employee"))) {
        await trpcClient.workforce.setEmployeeWage.mutate({
          targetUserId: numericUserId,
          dailyWage: validatedWage,
        });
      }
    }

    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: current.managedUsers.map((user) =>
          user.id === userId
            ? {
                ...user,
                ...updates,
                identifier: cleanPhone,
                dailyWage: (updates.role || user.role) === "employee" ? validatedWage : 0,
                displayName: updates.displayName?.trim() || user.displayName,
              }
            : user
        ),
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });

    return true;
  }, [data.managedUsers, data.session?.role]);

  const updateEmployeeWage = useCallback(async (userId: string, newDailyWage: number) => {
    const target = data.managedUsers.find((user) => user.id === userId);
    if (!target) return false;
    const allowed = canSetEmployeeWage({
      actorRole: data.session?.role,
      actorId: data.session?.id,
      targetUserId: userId,
      targetUserRole: target.role,
      targetManagerId: target.managerId,
    });
    if (!allowed) return false;

    const numericUserId = parseInt(userId, 10);
    if (isNaN(numericUserId)) {
      throw new Error(`Invalid user ID: ${userId}`);
    }

    const validatedWage = Math.max(0, Math.min(100000, Math.round(newDailyWage || 0)));
    const { trpcClient } = require("@/lib/trpc");
    await trpcClient.workforce.setEmployeeWage.mutate({
      targetUserId: numericUserId,
      dailyWage: validatedWage,
    });

    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: current.managedUsers.map((user) =>
          user.id === userId ? { ...user, dailyWage: validatedWage } : user
        ),
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });
    return true;
  }, [data.managedUsers, data.session?.id, data.session?.role]);

  const createTask = useCallback(async (input: {
    title: string;
    description?: string;
    assignedToUserId: string;
    assignedToName?: string;
    scheduledDate: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    locationAddress?: string;
    customerName?: string;
  }) => {
    let numericUserId = parseInt(input.assignedToUserId, 10);
    if (isNaN(numericUserId)) {
      const user = data.managedUsers.find((u) => u.id === input.assignedToUserId);
      if (user) {
        numericUserId = parseInt(user.id, 10);
      }
    }
    if (isNaN(numericUserId)) {
      throw new Error(`Invalid employee ID: ${input.assignedToUserId}. Must be a valid registered employee.`);
    }

    const { trpcClient } = require("@/lib/trpc");
    const serverTask = await trpcClient.tasks.create.mutate({
      title: input.title.trim(),
      description: input.description?.trim(),
      assignedToUserId: numericUserId,
      scheduledDate: input.scheduledDate,
      priority: input.priority,
      locationAddress: input.locationAddress?.trim(),
      customerName: input.customerName?.trim(),
    });

    const newTask = {
      id: serverTask.id,
      title: serverTask.title,
      description: serverTask.description || undefined,
      assignedToUserId: String(serverTask.assignedToUserId),
      assignedToName: input.assignedToName,
      assignedByUserId: String(serverTask.assignedByUserId),
      assignedByName: data.session?.displayName || "Administrator",
      scheduledDate: serverTask.scheduledDate,
      priority: serverTask.priority,
      status: serverTask.status,
      locationAddress: serverTask.locationAddress || undefined,
      customerName: serverTask.customerName || undefined,
      createdAt: new Date(serverTask.createdAt).toISOString(),
      updatedAt: new Date(serverTask.updatedAt).toISOString(),
    };

    setData((current) => {
      const nextWorkspace = {
        ...current,
        tasks: [newTask, ...current.tasks.filter((t) => t.id !== newTask.id)],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });

    return serverTask.id;
  }, [data.managedUsers, data.session?.displayName]);

  const updateTaskStatus = useCallback(async (taskId: string, newStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED") => {
    const { trpcClient } = require("@/lib/trpc");
    let updatedServerTask: any = null;
    try {
      updatedServerTask = await trpcClient.tasks.updateStatus.mutate({
        taskId,
        status: newStatus,
      });
    } catch (err) {
      console.warn("[Tasks] Server update status queued offline:", err);
      const { enqueueOperation } = require("@/lib/offline-sync");
      await enqueueOperation("TASK_UPDATE", { taskId, status: newStatus }, "high").catch(() => {});
    }

    const now = new Date().toISOString();
    setData((current) => {
      const nextWorkspace = {
        ...current,
        tasks: current.tasks.map((task) => {
          if (task.id !== taskId) return task;
          const updates: Record<string, unknown> = {
            status: newStatus,
            updatedAt: now,
          };
          if (newStatus === "IN_PROGRESS" && !task.startedAt) {
            updates.startedAt = updatedServerTask?.startedAt ? new Date(updatedServerTask.startedAt).toISOString() : now;
          }
          if (newStatus === "COMPLETED") {
            updates.completedAt = updatedServerTask?.completedAt ? new Date(updatedServerTask.completedAt).toISOString() : now;
          }
          return { ...task, ...updates } as typeof task;
        }),
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });
  }, []);

  const startRouteTracking = useCallback(async () => {
    try {
      const result = await startManagedRouteTracking((point) => {
        setData((current) => ({
          ...current,
          routePoints: [...current.routePoints, { ...point, id: createId("route"), employeeId: current.session?.id }],
        }));
      });
      setData((current) => ({ ...current, trackingActive: result.mode !== "idle", trackingMode: result.mode }));
      return result;
    } catch {
      const result: TrackingStartResult = { mode: "idle", reason: "error" };
      setData((current) => ({ ...current, trackingActive: false, trackingMode: "idle" }));
      return result;
    }
  }, []);

  const stopRouteTracking = useCallback(async () => {
    await stopManagedRouteTracking().catch(() => undefined);
    setData((current) => ({ ...current, trackingActive: false, trackingMode: "idle" }));
  }, []);

  const captureAttendance = useCallback(async (input: AttendanceCaptureInput): Promise<AttendanceCaptureResult> => {
    // Only field employees participate in attendance check-in
    if (data.session?.role && data.session.role !== "employee") {
      throw new Error("Forbidden: Admin and Manager are salaried management and do not participate in attendance check-in.");
    }

    const isOfflineErr = (e: any) => {
      const msg = (e?.message || "").toLowerCase();
      return (
        msg.includes("failed to fetch") ||
        msg.includes("network request failed") ||
        msg.includes("network error") ||
        msg.includes("connection refused") ||
        (typeof navigator !== "undefined" && !navigator.onLine)
      );
    };

    if (input.action === "check-in") {
      let serverResult: any = null;
      const idempotencyKey = `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      try {
        const { trpcClient } = require("@/lib/trpc");
        serverResult = await trpcClient.attendance.checkIn.mutate({
          checkInPhotoUri: input.photoUri,
          checkInLat: String(input.location.latitude),
          checkInLng: String(input.location.longitude),
          checkInAccuracy: input.location.accuracy ? Math.round(input.location.accuracy) : undefined,
          idempotencyKey,
        });
      } catch (err: any) {
        if (!isOfflineErr(err)) {
          // Real server rejection (e.g. outside geofence, duplicate open check-in, missing photo, not employee).
          // Surface error and DO NOT save local record!
          throw err;
        }
        // Truly offline: enqueue into offline queue with idempotencyKey
        const { enqueueOperation } = require("@/lib/offline-sync");
        await enqueueOperation(
          "ATTENDANCE_CHECK_IN",
          {
            photoUri: input.photoUri,
            location: input.location,
            idempotencyKey,
          },
          "high"
        ).catch(() => {});
      }

      const capturedAt = new Date().toISOString();
      const status: AttendanceRecord["status"] = serverResult
        ? serverResult.status
        : verificationStatus(input.location);

      const record: AttendanceRecord = {
        id: serverResult ? serverResult.id : idempotencyKey,
        employeeId: data.session?.id,
        checkInAt: serverResult ? new Date(serverResult.checkInAt).toISOString() : capturedAt,
        checkInPhotoUri: input.photoUri,
        checkInLocation: input.location,
        status,
        lateEarlyLabel: "On time",
        syncState: serverResult ? "synced" : "awaiting-server",
      };

      setData((current) => {
        const nextWorkspace = {
          ...current,
          attendance: [record, ...current.attendance.filter((r) => r.id !== record.id)],
        };
        persistWorkspaceToStorage(nextWorkspace);
        return nextWorkspace;
      });

      if (!shouldStartTrackingAfterAttendance({ attendanceAction: input.action, trackingActive: data.trackingActive })) {
        return { action: input.action, trackingStopped: false };
      }

      const tracking = await startRouteTracking();
      if (shouldEscalateTrackingPermission(tracking)) {
        const alert: TrackingPermissionAlert = {
          id: createId("tracking-alert"),
          employeeId: data.session?.id,
          employeeName: data.session?.displayName ?? "Field employee",
          createdAt: new Date().toISOString(),
          reason: "location-permission-denied",
          recipientRoles: ["manager", "admin"],
          status: "awaiting-server",
        };
        setData((current) => ({
          ...current,
          trackingPermissionAlerts: [alert, ...current.trackingPermissionAlerts],
          offlineQueue: [queueOperation("alert", `Tracking permission alert for “${alert.employeeName}” awaiting manager/admin delivery`), ...current.offlineQueue],
        }));
      }
      return { action: input.action, tracking, trackingStopped: false };
    } else {
      // Check-out
      let serverResult: any = null;
      try {
        const { trpcClient } = require("@/lib/trpc");
        serverResult = await trpcClient.attendance.checkOut.mutate({
          checkOutPhotoUri: input.photoUri,
        });
      } catch (err: any) {
        if (!isOfflineErr(err)) {
          throw err;
        }
        const { enqueueOperation } = require("@/lib/offline-sync");
        await enqueueOperation(
          "ATTENDANCE_CHECK_OUT",
          { photoUri: input.photoUri, location: input.location },
          "high"
        ).catch(() => {});
      }

      const capturedAt = new Date().toISOString();
      setData((current) => {
        const updatedAttendance = current.attendance.map((rec) => {
          if (
            (serverResult && rec.id === serverResult.id) ||
            (!rec.checkOutAt && (!rec.employeeId || rec.employeeId === current.session?.id))
          ) {
            return {
              ...rec,
              checkOutAt: capturedAt,
              checkOutPhotoUri: input.photoUri,
              checkOutLocation: input.location,
              status: (serverResult?.status as any) || rec.status,
              syncState: serverResult ? ("synced" as const) : ("awaiting-server" as const),
            };
          }
          return rec;
        });

        const nextWorkspace = {
          ...current,
          attendance: updatedAttendance,
        };
        persistWorkspaceToStorage(nextWorkspace);
        return nextWorkspace;
      });

      const trackingStopped = data.trackingActive;
      if (trackingStopped) await stopRouteTracking();
      return { action: input.action, trackingStopped };
    }
  }, [data.session?.displayName, data.session?.id, data.session?.role, data.trackingActive, startRouteTracking, stopRouteTracking]);

  const captureVisitEvidence = useCallback((input: VisitCaptureInput) => {
    const capturedAt = new Date().toISOString();
    setData((current) => ({
      ...current,
      visits: current.visits.map((visit) => {
        if (visit.id !== input.visitId) return visit;
        const evidenceUris = [...visit.evidenceUris, input.photoUri];
        return input.action === "check-in"
          ? {
              ...visit,
              status: "checked-in",
              checkInAt: capturedAt,
              checkInLocation: input.location,
              evidenceUris,
            }
          : {
              ...visit,
              status: "completed",
              checkOutAt: capturedAt,
              checkOutLocation: input.location,
              evidenceUris,
            };
      }),
      offlineQueue: [
        queueOperation(
          "visit",
          input.action === "check-in" ? "Visit check-in awaiting secure sync" : "Visit check-out awaiting secure sync",
        ),
        queueOperation("media", "Visit photo evidence awaiting upload"),
        ...current.offlineQueue,
      ],
    }));
  }, []);

  const addCustomer = useCallback((input: Omit<Customer, "id" | "createdAt">) => {
    const id = createId("customer");
    const customer: Customer = { ...input, id, createdAt: new Date().toISOString() };
    setData((current) => ({
      ...current,
      customers: [customer, ...current.customers],
      offlineQueue: [queueOperation("customer", `Customer “${customer.name}” awaiting secure sync`), ...current.offlineQueue],
    }));
    return id;
  }, []);

  const createVisit = useCallback(
    (input: Omit<Visit, "id" | "employeeId" | "status" | "checkInAt" | "checkOutAt" | "checkInLocation" | "checkOutLocation" | "evidenceUris" | "meetingOutcome" | "notes" | "followUpDate">) => {
      const id = createId("visit");
      const visit: Visit = { ...input, id, employeeId: data.session?.id, status: "scheduled", evidenceUris: [] };
      setData((current) => ({
        ...current,
        visits: [visit, ...current.visits],
        offlineQueue: [queueOperation("visit", "New customer visit awaiting secure sync"), ...current.offlineQueue],
      }));
      return id;
    },
    [],
  );

  const updateVisit = useCallback(
    (visitId: string, input: Pick<Visit, "meetingOutcome" | "notes" | "followUpDate">) => {
      setData((current) => ({
        ...current,
        visits: current.visits.map((visit) => (visit.id === visitId ? { ...visit, ...input } : visit)),
        offlineQueue: [queueOperation("visit", "Visit report awaiting secure sync"), ...current.offlineQueue],
      }));
    },
    [],
  );

  const sendMessage = useCallback((text: string) => {
    const message: ChatMessage = {
      id: createId("message"),
      text: text.trim(),
      sender: "employee",
      createdAt: new Date().toISOString(),
      delivery: "awaiting-server",
    };
    if (!message.text) return;

    setData((current) => ({
      ...current,
      messages: [...current.messages, message],
      offlineQueue: [queueOperation("message", "Team message awaiting secure sync"), ...current.offlineQueue],
    }));
  }, []);

  const addRoutePoint = useCallback(async (point: LocationEvidence) => {
    const routePoint: RoutePoint = { ...point, id: createId("route"), employeeId: data.session?.id };
    setData((current) => ({ ...current, routePoints: [...current.routePoints, routePoint] }));

    try {
      if (data.session?.role === "employee") {
        const { trpcClient } = require("@/lib/trpc");
        await trpcClient.tracking.recordPoint.mutate({
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy ? Math.round(point.accuracy) : undefined,
          isMocked: point.mocked,
        });
      }
    } catch (err) {
      console.warn("[Tracking] Server record point warning:", err);
    }
  }, [data.session?.id, data.session?.role]);

  const setTrackingActive = useCallback((active: boolean) => {
    setData((current) => ({ ...current, trackingActive: active, trackingMode: active ? current.trackingMode === "idle" ? "foreground" : current.trackingMode : "idle" }));
  }, []);

  const setNotificationsEnabled = useCallback((enabled: boolean) => {
    setData((current) => ({ ...current, notificationsEnabled: enabled }));
  }, []);

  const value = useMemo<FieldDataContextValue>(
    () => ({
      data,
      isHydrated,
      signInToPreview,
      setServerSession,
      signOut,
      createManagedUser,
      issueManagedUserAccess,
      removeManagedUser,
      updateManagedUser,
      updateEmployeeWage,
      createTask,
      updateTaskStatus,
      captureAttendance,
      captureVisitEvidence,
      addCustomer,
      createVisit,
      updateVisit,
      sendMessage,
      addRoutePoint,
      startRouteTracking,
      stopRouteTracking,
      setTrackingActive,
      setNotificationsEnabled,
    }),
    [
      addCustomer,
      addRoutePoint,
      captureAttendance,
      captureVisitEvidence,
      createManagedUser,
      issueManagedUserAccess,
      removeManagedUser,
      updateManagedUser,
      updateEmployeeWage,
      createTask,
      updateTaskStatus,
      createVisit,
      data,
      isHydrated,
      sendMessage,
      setNotificationsEnabled,
      setServerSession,
      setTrackingActive,
      startRouteTracking,
      stopRouteTracking,
      signInToPreview,
      signOut,
      updateVisit,
    ],
  );

  return <FieldDataContext.Provider value={value}>{children}</FieldDataContext.Provider>;
}

export function useFieldData() {
  const context = useContext(FieldDataContext);
  if (!context) throw new Error("useFieldData must be used within FieldDataProvider");
  return context;
}

export function getDayKey(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

export function formatTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatDay(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
