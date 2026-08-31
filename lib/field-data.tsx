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
  signInToPreview: (identifier: string, role?: FieldSession["role"]) => void;
  signOut: () => void;
  createManagedUser: (input: Omit<ManagedUser, "id" | "accountLinkId" | "status" | "createdAt" | "accessIssuedAt">) => string;
  issueManagedUserAccess: (userId: string) => boolean;
  removeManagedUser: (userId: string) => boolean;
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

function buildPreviewSession(identifier: string, selectedRole?: FieldSession["role"]): FieldSession {
  const trimmedIdentifier = identifier.trim();
  const displayName = trimmedIdentifier.includes("@")
    ? trimmedIdentifier.split("@")[0]
    : "Field employee";
  const inferredRole = trimmedIdentifier.toLowerCase().includes("admin")
    ? "admin"
    : trimmedIdentifier.toLowerCase().includes("manager")
      ? "manager"
      : "employee";

  return {
    id: createId("preview-user"),
    identifier: trimmedIdentifier,
    displayName: displayName || "Field employee",
    role: selectedRole ?? inferredRole,
    isPreview: true,
    signedInAt: new Date().toISOString(),
  };
}

export function FieldDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FieldWorkspace>(emptyWorkspace);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    const hydrationFallback = setTimeout(() => {
      if (active) setIsHydrated(true);
    }, 900);

    Promise.all([
      AsyncStorage.getItem(FIELD_WORKSPACE_KEY),
      Platform.OS === "web"
        ? Promise.resolve(typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(FIELD_SESSION_KEY))
        : SecureStore.getItemAsync(FIELD_SESSION_KEY),
    ])
      .then(([workspaceValue, sessionValue]) => {
        if (!active) return;
        const parsedWorkspace = workspaceValue ? (JSON.parse(workspaceValue) as Partial<FieldWorkspace>) : {};
        const parsedSession = sessionValue ? (JSON.parse(sessionValue) as FieldSession) : null;
        setData({ ...emptyWorkspace, ...parsedWorkspace, session: parsedSession });
      })
      .catch(() => {
        if (active) setData(emptyWorkspace);
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
    const { session, ...workspace } = data;
    AsyncStorage.setItem(FIELD_WORKSPACE_KEY, JSON.stringify(workspace)).catch(() => undefined);
    if (Platform.OS === "web") {
      if (typeof sessionStorage === "undefined") return;
      if (session) sessionStorage.setItem(FIELD_SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(FIELD_SESSION_KEY);
      return;
    }
    if (session) {
      SecureStore.setItemAsync(FIELD_SESSION_KEY, JSON.stringify(session), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }).catch(() => undefined);
    } else {
      SecureStore.deleteItemAsync(FIELD_SESSION_KEY).catch(() => undefined);
    }
  }, [data, isHydrated]);

  const signInToPreview = useCallback((identifier: string, role?: FieldSession["role"]) => {
    const session = buildPreviewSession(identifier, role);
    const workspaceUser: ManagedUser = {
      id: session.id,
      accountLinkId: `account-${session.id}`,
      displayName: session.displayName,
      identifier: session.identifier,
      role: session.role,
      status: "active",
      dailyWage: 0,
      createdAt: session.signedInAt,
    };
    setData((current) => {
      const existingUser = current.managedUsers.find((user) => user.identifier.toLowerCase() === session.identifier.toLowerCase());
      return {
        ...current,
        session,
        managedUsers: existingUser
          ? current.managedUsers.map((user) => user.identifier.toLowerCase() === session.identifier.toLowerCase() ? { ...user, ...workspaceUser, id: user.id } : user)
          : [workspaceUser, ...current.managedUsers],
      };
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
      status: "invited",
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
    setData((current) => ({
      ...current,
      managedUsers: [user, ...current.managedUsers],
      accountEvents: [event, ...current.accountEvents],
      offlineQueue: [queueOperation("account", `Account invitation for “${user.displayName}” awaiting secure sync`), ...current.offlineQueue],
    }));
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
    setData((current) => ({
      ...current,
      managedUsers: current.managedUsers.map((user) => user.id === userId ? { ...user, status: "active", accessIssuedAt: issuedAt } : user),
      accountEvents: [event, ...current.accountEvents],
      offlineQueue: [queueOperation("account", `Account access for “${target.displayName}” awaiting secure delivery`), ...current.offlineQueue],
    }));
    return true;
  }, [data.managedUsers, data.session?.id, data.session?.role]);

  const removeManagedUser = useCallback((userId: string) => {
    const target = data.managedUsers.find((user) => user.id === userId);
    if (!target || !canRemoveManagedAccount({ role: data.session?.role, actorId: data.session?.id, targetUserId: userId })) return false;
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
    setData((current) => ({
      ...current,
      managedUsers: current.managedUsers.filter((user) => user.id !== userId),
      accountEvents: [event, ...current.accountEvents],
      offlineQueue: [queueOperation("account", `Account removal for “${target.displayName}” awaiting secure sync`), ...current.offlineQueue],
    }));
    return true;
  }, [data.managedUsers, data.session?.id, data.session?.role]);

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
    setData((current) => ({
      ...current,
      managedUsers: current.managedUsers.map((user) =>
        user.id === userId ? { ...user, dailyWage: validatedWage } : user
      ),
      offlineQueue: [
        queueOperation("account", `Wage update for “${target.displayName}” (₹${validatedWage}/day) awaiting secure sync`),
        ...current.offlineQueue,
      ],
    }));
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
    const capturedAt = new Date().toISOString();
    const status = verificationStatus(input.location);

    setData((current) => {
      const openAttendance = current.attendance.find((record) => !record.checkOutAt && (!record.employeeId || record.employeeId === current.session?.id));

      if (input.action === "check-out" && openAttendance) {
        const checkoutStatus: AttendanceRecord["status"] =
          openAttendance.status === "verified" && status === "verified" ? "verified" : "review";
        const updatedAttendance = current.attendance.map((record) =>
          record.id === openAttendance.id
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

      const record: AttendanceRecord = {
        id: createId("attendance"),
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

  const addRoutePoint = useCallback((point: LocationEvidence) => {
    const routePoint: RoutePoint = { ...point, id: createId("route"), employeeId: data.session?.id };
    setData((current) => ({ ...current, routePoints: [...current.routePoints, routePoint] }));
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
