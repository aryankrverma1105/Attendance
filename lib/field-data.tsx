import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type {
  AccountLifecycleEvent,
  AttendanceRecord,
  ChatMessage,
  Customer,
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
import { trpcClient } from "@/lib/trpc";
import { enqueueOperation } from "@/lib/offline-sync";

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
  signOut: () => void;
  createManagedUser: (input: Omit<ManagedUser, "id" | "accountLinkId" | "status" | "createdAt" | "accessIssuedAt">) => string;
  issueManagedUserAccess: (userId: string) => boolean;
  removeManagedUser: (userId: string) => boolean;
  updateManagedUser: (userId: string, updates: Partial<Omit<ManagedUser, "id" | "createdAt">>) => boolean;
  updateEmployeeWage: (userId: string, newDailyWage: number) => boolean;
  createTask: (input: {
    title: string;
    description?: string;
    assignedToUserId: string;
    assignedToName?: string;
    scheduledDate: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    locationAddress?: string;
    customerName?: string;
  }) => string;
  updateTaskStatus: (taskId: string, newStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED") => void;
  captureAttendance: (input: AttendanceCaptureInput) => Promise<AttendanceCaptureResult>;
  captureVisitEvidence: (input: VisitCaptureInput) => void;
  addCustomer: (input: Omit<Customer, "id" | "createdAt">) => string;
  createVisit: (input: Omit<Visit, "id" | "status" | "checkInAt" | "checkOutAt" | "checkInLocation" | "checkOutLocation" | "evidenceUris" | "meetingOutcome" | "notes" | "followUpDate">) => string;
  updateVisit: (visitId: string, input: Pick<Visit, "meetingOutcome" | "notes" | "followUpDate">) => void;
  sendMessage: (text: string) => void;
  addRoutePoint: (point: LocationEvidence) => void;
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

export async function syncUsersWithServer(usersToSync?: ManagedUser[]): Promise<ManagedUser[] | null> {
  try {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return null;

    let authHeaders: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const { getSessionToken } = require("@/lib/_core/auth");
      const token = await getSessionToken().catch(() => null);
      if (token) {
        authHeaders["Authorization"] = `Bearer ${token}`;
      }
    } catch {}

    if (usersToSync && usersToSync.length > 0) {
      const res = await fetch(`${apiBase}/api/users/sync`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ users: usersToSync }),
      });
      const resData = await res.json();
      if (resData?.success && Array.isArray(resData?.users)) {
        return resData.users as ManagedUser[];
      }
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${apiBase}/api/users`, { signal: controller.signal });
      clearTimeout(timeout);
      const resData = await res.json();
      if (resData?.success && Array.isArray(resData?.users)) {
        return resData.users as ManagedUser[];
      }
    }
  } catch (err) {
    console.warn("[UserSync] Server sync warning:", err);
  }
  return null;
}

async function hydrateFromServer(
  current: FieldWorkspace,
  session: FieldSession
): Promise<Partial<FieldWorkspace>> {
  const updates: Partial<FieldWorkspace> = {};

  try {
    // 1. Tasks
    const serverTasks = await trpcClient.tasks.listAllTasks.query().catch(() => null);
    if (serverTasks && Array.isArray(serverTasks)) {
      const localTasks = current.tasks || [];
      const taskMap = new Map(localTasks.map((t) => [t.id, t]));
      for (const st of serverTasks) {
        const existing = taskMap.get(st.id);
        if (!existing) {
          taskMap.set(st.id, {
            id: st.id,
            title: st.title,
            description: st.description || undefined,
            assignedToUserId: String(st.assignedToUserId),
            assignedByUserId: String(st.assignedByUserId),
            scheduledDate: st.scheduledDate,
            priority: st.priority,
            status: st.status,
            locationAddress: st.locationAddress || undefined,
            customerName: st.customerName || undefined,
            startedAt: st.startedAt ? new Date(st.startedAt).toISOString() : undefined,
            completedAt: st.completedAt ? new Date(st.completedAt).toISOString() : undefined,
            createdAt: new Date(st.createdAt).toISOString(),
            updatedAt: new Date(st.updatedAt).toISOString(),
          });
        } else {
          taskMap.set(st.id, {
            ...existing,
            title: st.title,
            description: st.description || undefined,
            scheduledDate: st.scheduledDate,
            priority: st.priority,
            status: st.status,
            locationAddress: st.locationAddress || undefined,
            customerName: st.customerName || undefined,
            startedAt: st.startedAt ? new Date(st.startedAt).toISOString() : existing.startedAt,
            completedAt: st.completedAt ? new Date(st.completedAt).toISOString() : existing.completedAt,
            updatedAt: new Date(st.updatedAt).toISOString(),
          });
        }
      }
      updates.tasks = Array.from(taskMap.values());
    }
  } catch (e) {
    console.warn("[Hydration] Tasks error:", e);
  }

  try {
    // 2. Customers
    const serverCustomers = await trpcClient.customers.list.query().catch(() => null);
    if (serverCustomers && Array.isArray(serverCustomers)) {
      const localCustomers = current.customers || [];
      const custMap = new Map(localCustomers.map((c) => [c.id, c]));
      for (const sc of serverCustomers) {
        custMap.set(sc.id, {
          id: sc.id,
          name: sc.name,
          phone: sc.phone || undefined,
          address: sc.address || undefined,
          latitude: sc.latitude ? parseFloat(sc.latitude) : undefined,
          longitude: sc.longitude ? parseFloat(sc.longitude) : undefined,
          createdAt: new Date(sc.createdAt).toISOString(),
        });
      }
      updates.customers = Array.from(custMap.values());
    }
  } catch (e) {
    console.warn("[Hydration] Customers error:", e);
  }

  try {
    // 3. Visits
    const serverVisits = await trpcClient.visits.list.query().catch(() => null);
    if (serverVisits && Array.isArray(serverVisits)) {
      const localVisits = current.visits || [];
      const visitMap = new Map(localVisits.map((v) => [v.id, v]));
      for (const sv of serverVisits) {
        const mappedStatus: Visit["status"] =
          sv.status === "COMPLETED"
            ? "completed"
            : sv.status === "IN_PROGRESS"
            ? "checked-in"
            : "scheduled";
        const existing = visitMap.get(sv.id);
        if (!existing) {
          visitMap.set(sv.id, {
            id: sv.id,
            customerId: sv.customerId,
            employeeId: sv.employeeUserId ? String(sv.employeeUserId) : undefined,
            scheduledFor: new Date(sv.scheduledFor).toISOString(),
            status: mappedStatus,
            checkInAt: sv.checkInAt ? new Date(sv.checkInAt).toISOString() : undefined,
            checkOutAt: sv.checkOutAt ? new Date(sv.checkOutAt).toISOString() : undefined,
            meetingOutcome: sv.meetingOutcome || undefined,
            notes: sv.notes || undefined,
            followUpDate: sv.followUpDate || undefined,
            evidenceUris: [],
          });
        } else {
          visitMap.set(sv.id, {
            ...existing,
            scheduledFor: new Date(sv.scheduledFor).toISOString(),
            status: mappedStatus,
            checkInAt: sv.checkInAt ? new Date(sv.checkInAt).toISOString() : existing.checkInAt,
            checkOutAt: sv.checkOutAt ? new Date(sv.checkOutAt).toISOString() : existing.checkOutAt,
            meetingOutcome: sv.meetingOutcome || existing.meetingOutcome,
            notes: sv.notes || existing.notes,
            followUpDate: sv.followUpDate || existing.followUpDate,
          });
        }
      }
      updates.visits = Array.from(visitMap.values());
    }
  } catch (e) {
    console.warn("[Hydration] Visits error:", e);
  }

  try {
    // 4. Attendance (merge rule: any local record with syncState !== "synced" must NOT be overwritten)
    const serverAttendance = await trpcClient.attendance.getHistory.query({}).catch(() => null);
    if (serverAttendance && Array.isArray(serverAttendance)) {
      const localAttendance = current.attendance || [];
      const attMap = new Map(localAttendance.map((a) => [a.id, a]));
      for (const sa of serverAttendance) {
        const existing = attMap.get(sa.id);
        if (!existing || existing.syncState === "synced") {
          attMap.set(sa.id, {
            id: sa.id,
            employeeId: sa.userId ? String(sa.userId) : undefined,
            checkInAt: new Date(sa.checkInAt).toISOString(),
            checkOutAt: sa.checkOutAt ? new Date(sa.checkOutAt).toISOString() : undefined,
            checkInPhotoUri: sa.checkInPhotoUri || undefined,
            checkOutPhotoUri: sa.checkOutPhotoUri || undefined,
            checkInLocation:
              sa.checkInLat && sa.checkInLng
                ? {
                    latitude: parseFloat(sa.checkInLat),
                    longitude: parseFloat(sa.checkInLng),
                    accuracy: sa.checkInAccuracy ?? null,
                    capturedAt: new Date(sa.checkInAt).toISOString(),
                  }
                : undefined,
            status: sa.status === "verified" ? "verified" : "review",
            syncState: "synced",
          });
        }
      }
      updates.attendance = Array.from(attMap.values());
    }
  } catch (e) {
    console.warn("[Hydration] Attendance error:", e);
  }

  return updates;
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

    return () => {
      active = false;
      clearTimeout(hydrationFallback);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    persistWorkspaceToStorage(data);
  }, [data, isHydrated]);

  // Server hydration when session becomes active (login / multi-device reload)
  useEffect(() => {
    if (!data.session) return;
    let active = true;

    hydrateFromServer(data, data.session)
      .then((updates) => {
        if (!active || Object.keys(updates).length === 0) return;
        setData((prev) => {
          const next = { ...prev, ...updates };
          persistWorkspaceToStorage(next);
          return next;
        });
      })
      .catch((err) => {
        console.warn("[Hydration] Error during server sync:", err);
      });

    return () => {
      active = false;
    };
  }, [data.session?.id, data.session?.role]);

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

  const signOut = useCallback(() => {
    stopManagedRouteTracking().catch(() => undefined);
    setData((current) => ({ ...current, session: null, trackingActive: false, trackingMode: "idle" }));
    if (Platform.OS === "web") {
      if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(FIELD_SESSION_KEY);
      return;
    }
    SecureStore.deleteItemAsync(FIELD_SESSION_KEY).catch(() => undefined);
  }, []);

  const createManagedUser = useCallback((input: Omit<ManagedUser, "id" | "accountLinkId" | "status" | "createdAt" | "accessIssuedAt">) => {
    if (!canAdminManageAccount(data.session?.role)) return "";
    const accountLinkId = createId("account");
    const createdAt = new Date().toISOString();
    const user: ManagedUser = {
      ...input,
      dailyWage: input.dailyWage ?? 0,
      id: createId("member"),
      accountLinkId,
      status: "active",
      createdAt,
    };
    const event: AccountLifecycleEvent = {
      id: createId("account-event"),
      userId: user.id,
      accountLinkId,
      action: "account-created",
      performedById: data.session?.id,
      occurredAt: createdAt,
      detail: "Linked account invitation created and queued for secure delivery.",
    };
    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: [user, ...current.managedUsers],
        accountEvents: [event, ...current.accountEvents],
        offlineQueue: [queueOperation("account", `Account invitation for “${user.displayName}” awaiting secure sync`), ...current.offlineQueue],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });

    // Broadcast newly created user to VM instance immediately so all other devices receive it
    syncUsersWithServer([user]).catch((e) => console.warn("[UserSync] Push error:", e));

    return user.id;
  }, [data.session?.id, data.session?.role]);

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
      detail: "Account access invitation issued and queued for secure OTP delivery.",
    };
    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: current.managedUsers.map((user) =>
          user.id === userId ? { ...user, status: "active" as const, accessIssuedAt: issuedAt } : user
        ),
        accountEvents: [event, ...current.accountEvents],
        offlineQueue: [queueOperation("account", `Account access for “${target.displayName}” awaiting secure delivery`), ...current.offlineQueue],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });
    return true;
  }, [data.managedUsers, data.session?.id, data.session?.role]);

  const removeManagedUser = useCallback((userId: string) => {
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
    const removedAt = new Date().toISOString();
    const event: AccountLifecycleEvent = {
      id: createId("account-event"),
      userId,
      accountLinkId: target.accountLinkId,
      action: "account-removed",
      performedById: data.session?.id,
      occurredAt: removedAt,
      detail: "Linked account removed from the active directory; retained work records remain audit-only.",
    };
    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: current.managedUsers.filter((user) => user.id !== userId),
        accountEvents: [event, ...current.accountEvents],
        offlineQueue: [queueOperation("account", `Account removal for “${target.displayName}” awaiting secure sync`), ...current.offlineQueue],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });

    const apiBase = getApiBaseUrl();
    if (apiBase) {
      fetch(`${apiBase}/api/users/${userId}`, { method: "DELETE" }).catch(() => {});
    }

    return true;
  }, [data.managedUsers, data.session?.id, data.session?.identifier, data.session?.role]);

  const updateManagedUser = useCallback((userId: string, updates: Partial<Omit<ManagedUser, "id" | "createdAt">>) => {
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
        offlineQueue: [
          queueOperation("account", `Updated account details for “${updates.displayName || target.displayName}”`),
          ...current.offlineQueue,
        ],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });

    const updatedUser = {
      ...target,
      ...updates,
      identifier: cleanPhone,
      dailyWage: (updates.role || target.role) === "employee" ? validatedWage : 0,
      displayName: updates.displayName?.trim() || target.displayName,
    };
    syncUsersWithServer([updatedUser as ManagedUser]).catch(() => {});

    return true;
  }, [data.managedUsers, data.session?.role]);

  const updateEmployeeWage = useCallback((userId: string, newDailyWage: number) => {
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

    const validatedWage = Math.max(0, Math.min(100000, Math.round(newDailyWage || 0)));
    setData((current) => {
      const nextWorkspace = {
        ...current,
        managedUsers: current.managedUsers.map((user) =>
          user.id === userId ? { ...user, dailyWage: validatedWage } : user
        ),
        offlineQueue: [
          queueOperation("account", `Updated wage for “${target.displayName}” to ₹${validatedWage}/day`),
          ...current.offlineQueue,
        ],
      };
      persistWorkspaceToStorage(nextWorkspace);
      return nextWorkspace;
    });
    return true;
  }, [data.managedUsers, data.session?.id, data.session?.role]);

  const createTask = useCallback((input: {
    title: string;
    description?: string;
    assignedToUserId: string;
    assignedToName?: string;
    scheduledDate: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    locationAddress?: string;
    customerName?: string;
  }) => {
    const taskId = createId("task");
    const now = new Date().toISOString();
    const newTask = {
      id: taskId,
      title: input.title.trim(),
      description: input.description?.trim(),
      assignedToUserId: input.assignedToUserId,
      assignedToName: input.assignedToName,
      assignedByUserId: data.session?.id || "admin",
      assignedByName: data.session?.displayName || "Administrator",
      scheduledDate: input.scheduledDate,
      priority: input.priority,
      status: "PENDING" as const,
      locationAddress: input.locationAddress,
      customerName: input.customerName,
      createdAt: now,
      updatedAt: now,
    };

    setData((current) => ({
      ...current,
      tasks: [newTask, ...current.tasks],
      offlineQueue: [
        queueOperation("account", `Task “${newTask.title}” assigned to ${input.assignedToName || input.assignedToUserId}`),
        ...current.offlineQueue,
      ],
    }));

    const numericTarget = parseInt(input.assignedToUserId, 10);
    if (!isNaN(numericTarget) && numericTarget > 0) {
      const payload = {
        title: input.title.trim(),
        description: input.description?.trim(),
        assignedToUserId: numericTarget,
        scheduledDate: input.scheduledDate,
        priority: input.priority,
        locationAddress: input.locationAddress?.trim(),
        customerName: input.customerName?.trim(),
      };
      trpcClient.tasks.create
        .mutate(payload)
        .catch((err) => {
          console.warn("[Tasks] Server sync queued offline:", err);
          enqueueOperation("TASK_CREATE", payload, "normal").catch(() => {});
        });
    }

    return taskId;
  }, [data.session?.id, data.session?.displayName]);

  const updateTaskStatus = useCallback((taskId: string, newStatus: "PENDING" | "IN_PROGRESS" | "COMPLETED") => {
    const now = new Date().toISOString();
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) => {
        if (task.id !== taskId) return task;
        const updates: Record<string, unknown> = { status: newStatus, updatedAt: now };
        if (newStatus === "IN_PROGRESS" && !task.startedAt) updates.startedAt = now;
        if (newStatus === "COMPLETED") updates.completedAt = now;
        return { ...task, ...updates } as typeof task;
      }),
      offlineQueue: [
        queueOperation("account", `Task status updated to ${newStatus}`),
        ...current.offlineQueue,
      ],
    }));

    const payload = { taskId, status: newStatus };
    trpcClient.tasks.updateStatus
      .mutate(payload)
      .catch((err) => {
        console.warn("[Tasks] Server updateStatus queued offline:", err);
        enqueueOperation("TASK_UPDATE", payload, "normal").catch(() => {});
      });
  }, []);

  const startRouteTracking = useCallback(async () => {
    try {
      const result = await startManagedRouteTracking((point) => {
        setData((current) => ({
          ...current,
          routePoints: [...current.routePoints, { ...point, id: createId("route"), employeeId: current.session?.id }],
        }));
        enqueueOperation("GPS_POINT", point, "low").catch(() => {});
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
    const capturedAt = new Date().toISOString();
    const status = verificationStatus(input.location);
    const operationId = createId(input.action === "check-in" ? "att-in" : "att-out");
    const recordId = createId("attendance");

    setData((current) => {
      const openAttendance = current.attendance.find(
        (record) => !record.checkOutAt && (!record.employeeId || record.employeeId === current.session?.id || getDayKey(record.checkInAt) === getDayKey(capturedAt))
      );

      if (input.action === "check-out") {
        const targetRecord = openAttendance || current.attendance.find((record) => getDayKey(record.checkInAt) === getDayKey(capturedAt));
        if (targetRecord) {
          const checkoutStatus: AttendanceRecord["status"] =
            targetRecord.status === "verified" && status === "verified" ? "verified" : "review";
          const updatedAttendance = current.attendance.map((record) =>
            record.id === targetRecord.id
              ? {
                  ...record,
                  checkOutAt: capturedAt,
                  checkOutPhotoUri: input.photoUri,
                  checkOutLocation: input.location,
                  status: checkoutStatus,
                  syncState: "awaiting-server" as const,
                }
              : record,
          );
          return {
            ...current,
            attendance: updatedAttendance,
            offlineQueue: [
              queueOperation("attendance", "Attendance check-out awaiting secure sync"),
              ...current.offlineQueue,
            ],
          };
        }
      }

      const record: AttendanceRecord = {
        id: recordId,
        employeeId: current.session?.id,
        checkInAt: capturedAt,
        checkInPhotoUri: input.photoUri,
        checkInLocation: input.location,
        status,
        lateEarlyLabel: "Pending policy",
        syncState: "awaiting-server",
      };

      return {
        ...current,
        attendance: [record, ...current.attendance],
        offlineQueue: [
          queueOperation("attendance", "Attendance check-in awaiting secure sync"),
          ...current.offlineQueue,
        ],
      };
    });

    // Server mutation with offline queue fallback
    if (input.action === "check-in") {
      const payload = {
        checkInPhotoUri: input.photoUri,
        checkInLat: String(input.location.latitude),
        checkInLng: String(input.location.longitude),
        checkInAccuracy: input.location.accuracy !== null ? input.location.accuracy : undefined,
        operationId,
        isMocked: input.location.mocked,
      };
      trpcClient.attendance.checkIn
        .mutate(payload)
        .then((res) => {
          setData((current) => ({
            ...current,
            attendance: current.attendance.map((r) =>
              r.id === recordId || (!r.checkOutAt && r.employeeId === current.session?.id)
                ? { ...r, id: res?.id || r.id, syncState: "synced" as const }
                : r
            ),
          }));
        })
        .catch((err) => {
          console.warn("[Attendance] Server check-in queued offline:", err);
          enqueueOperation("ATTENDANCE_CHECK_IN", payload, "high").catch(() => {});
        });
    } else {
      const payload = {
        checkOutPhotoUri: input.photoUri,
        operationId,
      };
      trpcClient.attendance.checkOut
        .mutate(payload)
        .then(() => {
          setData((current) => ({
            ...current,
            attendance: current.attendance.map((r) =>
              r.checkOutAt && (r.employeeId === current.session?.id || getDayKey(r.checkInAt) === getDayKey(capturedAt))
                ? { ...r, syncState: "synced" as const }
                : r
            ),
          }));
        })
        .catch((err) => {
          console.warn("[Attendance] Server check-out queued offline:", err);
          enqueueOperation("ATTENDANCE_CHECK_OUT", payload, "high").catch(() => {});
        });
    }

    if (input.action === "check-out") {
      const trackingStopped = data.trackingActive;
      if (trackingStopped) await stopRouteTracking();
      return { action: input.action, trackingStopped };
    }

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
  }, [data.session?.displayName, data.session?.id, data.trackingActive, startRouteTracking, stopRouteTracking]);

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

    if (input.action === "check-in") {
      const checkInPayload = {
        visitId: input.visitId,
        latitude: String(input.location.latitude),
        longitude: String(input.location.longitude),
      };
      trpcClient.visits.checkIn
        .mutate(checkInPayload)
        .catch((err) => {
          console.warn("[Visits] Server check-in queued offline:", err);
          enqueueOperation("VISIT_CHECK_IN", checkInPayload, "normal").catch(() => {});
        });
    } else {
      const completePayload = {
        visitId: input.visitId,
        latitude: String(input.location.latitude),
        longitude: String(input.location.longitude),
      };
      trpcClient.visits.complete
        .mutate(completePayload)
        .catch((err) => {
          console.warn("[Visits] Server complete queued offline:", err);
          enqueueOperation("VISIT_COMPLETE", completePayload, "normal").catch(() => {});
        });
    }

    const evidencePayload = {
      visitId: input.visitId,
      evidenceUrl: input.photoUri,
      latitude: String(input.location.latitude),
      longitude: String(input.location.longitude),
    };
    trpcClient.visits.addEvidence
      .mutate(evidencePayload)
      .catch((err) => {
        console.warn("[Visits] Server addEvidence queued offline:", err);
        enqueueOperation("VISIT_EVIDENCE", evidencePayload, "normal").catch(() => {});
      });
  }, []);

  const addCustomer = useCallback((input: Omit<Customer, "id" | "createdAt">) => {
    const id = createId("customer");
    const customer: Customer = { ...input, id, createdAt: new Date().toISOString() };
    setData((current) => ({
      ...current,
      customers: [customer, ...current.customers],
      offlineQueue: [queueOperation("customer", `Customer “${customer.name}” awaiting secure sync`), ...current.offlineQueue],
    }));

    const payload = {
      name: input.name.trim(),
      phone: input.phone?.trim() || undefined,
      address: input.address?.trim() || undefined,
      latitude: input.latitude !== undefined && input.latitude !== null ? String(input.latitude) : undefined,
      longitude: input.longitude !== undefined && input.longitude !== null ? String(input.longitude) : undefined,
    };
    trpcClient.customers.create
      .mutate(payload)
      .catch((err) => {
        console.warn("[Customers] Server create queued offline:", err);
        enqueueOperation("CUSTOMER_CREATE", payload, "normal").catch(() => {});
      });

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

      const empId = data.session?.id ? parseInt(data.session.id, 10) : undefined;
      const payload = {
        customerId: input.customerId,
        employeeUserId: empId && !isNaN(empId) ? empId : undefined,
        scheduledFor: input.scheduledFor,
        notes: undefined,
      };
      trpcClient.visits.create
        .mutate(payload)
        .catch((err) => {
          console.warn("[Visits] Server create queued offline:", err);
          enqueueOperation("VISIT_CREATE", payload, "normal").catch(() => {});
        });

      return id;
    },
    [data.session?.id],
  );

  const updateVisit = useCallback(
    (visitId: string, input: Pick<Visit, "meetingOutcome" | "notes" | "followUpDate">) => {
      setData((current) => ({
        ...current,
        visits: current.visits.map((visit) => (visit.id === visitId ? { ...visit, ...input } : visit)),
        offlineQueue: [queueOperation("visit", "Visit report awaiting secure sync"), ...current.offlineQueue],
      }));

      const payload = {
        visitId,
        meetingOutcome: input.meetingOutcome,
        notes: input.notes,
        followUpDate: input.followUpDate,
      };
      trpcClient.visits.updateNotes
        .mutate(payload)
        .catch((err) => {
          console.warn("[Visits] Server updateNotes queued offline:", err);
          enqueueOperation("VISIT_UPDATE_NOTES", payload, "normal").catch(() => {});
        });
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

    (async () => {
      try {
        const channel = await trpcClient.chat.getOrCreateChannel.mutate({ targetUserId: 1 });
        if (channel?.id) {
          await trpcClient.chat.sendMessage.mutate({ channelId: channel.id, message: message.text });
        } else {
          await enqueueOperation("CHAT_MESSAGE", { message: message.text }, "high");
        }
      } catch (err) {
        console.warn("[Chat] Server sendMessage queued offline:", err);
        await enqueueOperation("CHAT_MESSAGE", { message: message.text }, "high").catch(() => {});
      }
    })();
  }, []);

  const addRoutePoint = useCallback((point: LocationEvidence) => {
    const routePoint: RoutePoint = { ...point, id: createId("route"), employeeId: data.session?.id };
    setData((current) => ({ ...current, routePoints: [...current.routePoints, routePoint] }));
    enqueueOperation("GPS_POINT", point, "low").catch(() => {});
  }, [data.session?.id]);

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
      createVisit,
      data,
      isHydrated,
      sendMessage,
      setNotificationsEnabled,
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
