import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { trpcClient } from "@/lib/trpc";

export type OperationType =
  | "ATTENDANCE_CHECK_IN"
  | "ATTENDANCE_CHECK_OUT"
  | "UPLOAD_SELFIE"
  | "GPS_POINT"
  | "TASK_CREATE"
  | "TASK_UPDATE"
  | "CUSTOMER_CREATE"
  | "CUSTOMER_UPDATE"
  | "VISIT_CREATE"
  | "VISIT_CHECK_IN"
  | "VISIT_COMPLETE"
  | "VISIT_UPDATE_NOTES"
  | "VISIT_EVIDENCE"
  | "EXPENSE_CREATE"
  | "CHAT_MESSAGE";

export interface QueuedOperation<T = any> {
  operationId: string;
  type: OperationType;
  payload: T;
  createdAt: string;
  attemptCount: number;
  lastAttemptAt?: string;
  status: "queued" | "syncing" | "failed" | "dead_letter";
  error?: string;
  priority: "high" | "normal" | "low";
}

let _currentQueueUserId: string | null = null;
let _isFlushingQueue = false;
let _isQueuePausedForAuth = false;

export function setOfflineQueueUserId(userId: string | number | null) {
  _currentQueueUserId = userId ? String(userId) : null;
}

export function isQueuePaused(): boolean {
  return _isQueuePausedForAuth;
}

export function resumeQueue(): void {
  _isQueuePausedForAuth = false;
}

function getQueueStorageKey(): string {
  return _currentQueueUserId ? `@fieldpulse_offline_queue_u_${_currentQueueUserId}` : "@fieldpulse_offline_queue_v2";
}

const MAX_RETRY_ATTEMPTS = 5;

function generateOperationId(type: string): string {
  return `op_${type.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load queue from persistent device storage.
 */
export async function getOfflineQueue(): Promise<QueuedOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(getQueueStorageKey());
    if (!raw) return [];
    return JSON.parse(raw) as QueuedOperation[];
  } catch (err) {
    console.error("[OfflineSync] Failed to read queue:", err);
    return [];
  }
}

/**
 * Save queue to persistent device storage.
 */
export async function saveOfflineQueue(queue: QueuedOperation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(getQueueStorageKey(), JSON.stringify(queue));
  } catch (err) {
    console.error("[OfflineSync] Failed to save queue:", err);
  }
}

/**
 * Clear queue completely on logout.
 */
export async function clearOfflineQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(getQueueStorageKey());
    await AsyncStorage.removeItem("@fieldpulse_offline_queue_v2");
    _isQueuePausedForAuth = false;
  } catch (err) {
    console.error("[OfflineSync] Failed to clear queue:", err);
  }
}

/**
 * Enqueue a new operation with priority.
 */
export async function enqueueOperation<T = any>(
  type: OperationType,
  payload: T,
  priority: "high" | "normal" | "low" = "normal"
): Promise<QueuedOperation<T>> {
  const queue = await getOfflineQueue();
  const operation: QueuedOperation<T> = {
    operationId: generateOperationId(type),
    type,
    payload,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: "queued",
    priority,
  };

  // Prepend high priority, append normal/low
  if (priority === "high") {
    queue.unshift(operation);
  } else {
    queue.push(operation);
  }

  await saveOfflineQueue(queue);
  return operation;
}

/**
 * Update operation status.
 */
export async function updateOperationStatus(
  operationId: string,
  updates: Partial<QueuedOperation>
): Promise<void> {
  const queue = await getOfflineQueue();
  const index = queue.findIndex((op) => op.operationId === operationId);
  if (index >= 0) {
    queue[index] = { ...queue[index], ...updates };
    await saveOfflineQueue(queue);
  }
}

/**
 * Remove an operation after successful sync.
 */
export async function removeOperation(operationId: string): Promise<void> {
  const queue = await getOfflineQueue();
  const filtered = queue.filter((op) => op.operationId !== operationId);
  await saveOfflineQueue(filtered);
}

/**
 * Calculate exponential backoff in milliseconds.
 */
export function getExponentialBackoffMs(attemptCount: number): number {
  const base = 1000; // 1s
  const factor = 2;
  const maxDelay = 30000; // 30s
  return Math.min(base * Math.pow(factor, attemptCount), maxDelay);
}

export type OperationSyncHandler = (operation: QueuedOperation) => Promise<boolean>;

export class SyncOperationError extends Error {
  status?: number;
  code?: string;
  isRestAuthMessage?: boolean;

  constructor(message: string, options?: { status?: number; code?: string; isRestAuthMessage?: boolean }) {
    super(message);
    this.name = "SyncOperationError";
    this.status = options?.status;
    this.code = options?.code;
    this.isRestAuthMessage = options?.isRestAuthMessage;
  }
}

/**
 * Flush all pending queue operations using the provided handler.
 * Includes flush mutex, auth failure pause, and 4xx dead-lettering.
 */
export async function flushOfflineQueue(
  handler: OperationSyncHandler = dispatchQueuedOperation
): Promise<{ processed: number; succeeded: number; failed: number }> {
  if (_isFlushingQueue) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  if (_isQueuePausedForAuth) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  _isFlushingQueue = true;
  try {
    try {
      const netState = await Network.getNetworkStateAsync();
      if (!netState.isConnected || !netState.isInternetReachable) {
        return { processed: 0, succeeded: 0, failed: 0 };
      }
    } catch {
      // If Network check is unavailable (e.g. web/test), proceed
    }

    const queue = await getOfflineQueue();
    const pending = queue.filter((op) => op.status === "queued" || op.status === "failed");

    if (pending.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;

    for (const op of pending) {
      await updateOperationStatus(op.operationId, {
        status: "syncing",
        lastAttemptAt: new Date().toISOString(),
      });

      try {
        const success = await handler(op);
        if (success) {
          await removeOperation(op.operationId);
          succeeded++;
        } else {
          const nextAttempts = op.attemptCount + 1;
          await updateOperationStatus(op.operationId, {
            attemptCount: nextAttempts,
            status: nextAttempts >= MAX_RETRY_ATTEMPTS ? "dead_letter" : "failed",
            error: "Server rejected or unhandled response",
          });
          failed++;
        }
      } catch (err: any) {
        const errStatus = err?.status;
        const errCode = err?.code;
        const isRestAuth = err?.isRestAuthMessage;

        // Classify errors by status/code only:
        // 401 and UNAUTHORIZED, plus 403 on REST routes with an auth message, pause the queue
        const isAuthPause =
          errStatus === 401 ||
          errCode === "UNAUTHORIZED" ||
          (errStatus === 403 && isRestAuth);

        if (isAuthPause) {
          _isQueuePausedForAuth = true;
          await updateOperationStatus(op.operationId, {
            status: "queued",
            error: "Session expired or unauthorized. Please re-login to resume sync.",
          });
          failed++;
          break; // Stop flushing remaining ops until user logs in
        }

        // 400/403/404/409/BAD_REQUEST/NOT_FOUND/CONFLICT dead-letter immediately
        const isDeadLetter =
          errStatus === 400 ||
          errStatus === 403 ||
          errStatus === 404 ||
          errStatus === 409 ||
          errCode === "BAD_REQUEST" ||
          errCode === "FORBIDDEN" ||
          errCode === "NOT_FOUND" ||
          errCode === "CONFLICT" ||
          errCode === "PARSE_ERROR";

        if (isDeadLetter) {
          await updateOperationStatus(op.operationId, {
            status: "dead_letter",
            error: `Rejected by server (${errCode || errStatus || "4xx"}): ${err.message || String(err)}`,
          });
          failed++;
        } else {
          // Network error or server 5xx: increment attempt count and retry with backoff
          const nextAttempts = op.attemptCount + 1;
          await updateOperationStatus(op.operationId, {
            attemptCount: nextAttempts,
            status: nextAttempts >= MAX_RETRY_ATTEMPTS ? "dead_letter" : "failed",
            error: err.message || String(err),
          });
          failed++;
        }
      }
    }

    return { processed: pending.length, succeeded, failed };
  } finally {
    _isFlushingQueue = false;
  }
}

/**
 * On app startup, reset any operations stuck in "syncing" status back to "failed"
 * so an interrupted app run does not orphan them forever.
 */
export async function resetStuckSyncingOperations(): Promise<number> {
  const queue = await getOfflineQueue();
  let resetCount = 0;
  const updated = queue.map((op) => {
    if (op.status === "syncing") {
      resetCount++;
      return {
        ...op,
        status: "failed" as const,
        error: "Interrupted during sync",
      };
    }
    return op;
  });

  if (resetCount > 0) {
    await saveOfflineQueue(updated);
  }
  return resetCount;
}

const FIELD_WORKSPACE_KEY = "fieldpulse.workspace.v1";

/**
 * When a queued operation succeeds, flip the record's syncState in persistent storage to "synced".
 */
async function markRecordSyncedInStorage(op: QueuedOperation): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(FIELD_WORKSPACE_KEY);
    if (!raw) return;
    const ws = JSON.parse(raw);
    const p = op.payload || {};
    let modified = false;

    if (op.type === "TASK_CREATE" || op.type === "TASK_UPDATE") {
      const taskId = p.taskId || p.id;
      if (Array.isArray(ws.tasks)) {
        ws.tasks = ws.tasks.map((t: any) => {
          if (t.id === taskId || (op.type === "TASK_CREATE" && t.title === p.title && t.scheduledDate === p.scheduledDate)) {
            modified = true;
            return { ...t, syncState: "synced" };
          }
          return t;
        });
      }
    } else if (op.type === "CUSTOMER_CREATE" || op.type === "CUSTOMER_UPDATE") {
      const custId = p.id;
      if (Array.isArray(ws.customers)) {
        ws.customers = ws.customers.map((c: any) => {
          if (c.id === custId || (op.type === "CUSTOMER_CREATE" && c.name === p.name)) {
            modified = true;
            return { ...c, syncState: "synced" };
          }
          return c;
        });
      }
    } else if (
      op.type === "VISIT_CREATE" ||
      op.type === "VISIT_CHECK_IN" ||
      op.type === "VISIT_COMPLETE" ||
      op.type === "VISIT_UPDATE_NOTES" ||
      op.type === "VISIT_EVIDENCE"
    ) {
      const visitId = p.visitId || p.id;
      if (Array.isArray(ws.visits)) {
        ws.visits = ws.visits.map((v: any) => {
          if (
            v.id === visitId ||
            (op.type === "VISIT_CREATE" && v.customerId === p.customerId && v.scheduledFor === p.scheduledFor)
          ) {
            modified = true;
            return { ...v, syncState: "synced" };
          }
          return v;
        });
      }
    } else if (op.type === "ATTENDANCE_CHECK_IN" || op.type === "ATTENDANCE_CHECK_OUT") {
      if (Array.isArray(ws.attendance)) {
        ws.attendance = ws.attendance.map((a: any) => {
          if (
            (op.type === "ATTENDANCE_CHECK_IN" && (a.id === p.id || a.checkInAt === p.clientCheckInAt)) ||
            (op.type === "ATTENDANCE_CHECK_OUT" && a.checkOutAt === p.clientCheckOutAt)
          ) {
            modified = true;
            return { ...a, syncState: "synced" };
          }
          return a;
        });
      }
    }

    if (modified) {
      await AsyncStorage.setItem(FIELD_WORKSPACE_KEY, JSON.stringify(ws));
    }
  } catch (err) {
    console.warn("[OfflineSync] Failed to mark record synced in storage:", err);
  }
}

/**
 * Real tRPC dispatcher that maps every OperationType to its corresponding server mutation.
 * Returns true only on confirmed server success; throws typed SyncOperationError carrying status and code on failure.
 */
export async function dispatchQueuedOperation(op: QueuedOperation): Promise<boolean> {
  try {
    return await executeDispatchQueuedOperation(op);
  } catch (err: any) {
    if (err instanceof SyncOperationError) {
      throw err;
    }
    const status =
      err?.status ||
      err?.data?.httpStatus ||
      (err?.data?.code === "UNAUTHORIZED"
        ? 401
        : err?.data?.code === "FORBIDDEN"
        ? 403
        : err?.data?.code === "NOT_FOUND"
        ? 404
        : err?.data?.code === "CONFLICT"
        ? 409
        : err?.data?.code === "BAD_REQUEST"
        ? 400
        : undefined);
    const code = err?.data?.code || err?.code;
    const isRestAuth =
      err?.isRestAuthMessage || (status === 403 && /auth|token|unauthorized/i.test(err?.message || ""));
    throw new SyncOperationError(err?.message || "Operation failed", {
      status: typeof status === "number" ? status : undefined,
      code: typeof code === "string" ? code : undefined,
      isRestAuthMessage: Boolean(isRestAuth),
    });
  }
}

async function executeDispatchQueuedOperation(op: QueuedOperation): Promise<boolean> {
  const p = op.payload ?? {};

  switch (op.type) {
    case "ATTENDANCE_CHECK_IN": {
      await trpcClient.attendance.checkIn.mutate({
        checkInPhotoUri: p.checkInPhotoUri,
        checkInLat: p.checkInLat ? String(p.checkInLat) : undefined,
        checkInLng: p.checkInLng ? String(p.checkInLng) : undefined,
        checkInAccuracy: p.checkInAccuracy !== undefined && p.checkInAccuracy !== null ? Math.round(Number(p.checkInAccuracy)) : undefined,
        operationId: op.operationId || p.operationId,
        isMocked: p.isMocked,
        clientCheckInAt: p.clientCheckInAt || op.createdAt,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "ATTENDANCE_CHECK_OUT": {
      await trpcClient.attendance.checkOut.mutate({
        checkOutPhotoUri: p.checkOutPhotoUri,
        operationId: op.operationId || p.operationId,
        clientCheckOutAt: p.clientCheckOutAt || op.createdAt,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "UPLOAD_SELFIE": {
      const { getApiBaseUrl } = await import("@/constants/oauth");
      const { getSessionToken } = await import("@/lib/_core/auth");
      const apiBase = getApiBaseUrl();
      if (!apiBase) throw new SyncOperationError("API base URL not configured", { status: 503 });
      const token = await getSessionToken();
      const res = await fetch(`${apiBase}/api/upload-selfie`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          base64: p.base64,
          action: p.action,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error || `Upload failed with HTTP ${res.status}`;
        const isAuthMsg = /auth|token|unauthorized/i.test(errMsg);
        throw new SyncOperationError(errMsg, {
          status: res.status,
          code: res.status === 401 ? "UNAUTHORIZED" : res.status === 403 ? "FORBIDDEN" : res.status === 400 ? "BAD_REQUEST" : undefined,
          isRestAuthMessage: res.status === 403 && isAuthMsg,
        });
      }
      const uploadRes = await res.json();
      const serverUrl = uploadRes.url;

      if (p.nextAction === "ATTENDANCE_CHECK_IN") {
        await trpcClient.attendance.checkIn.mutate({
          ...p.attendancePayload,
          checkInPhotoUri: serverUrl,
          operationId: op.operationId,
        });
      } else if (p.nextAction === "ATTENDANCE_CHECK_OUT") {
        await trpcClient.attendance.checkOut.mutate({
          ...p.attendancePayload,
          checkOutPhotoUri: serverUrl,
          operationId: op.operationId,
        });
      } else if (p.nextAction === "VISIT_EVIDENCE") {
        const visitPayload = p.visitPayload || {};
        const visitId = String(visitPayload.visitId || p.visitId || "");
        const lat = visitPayload.latitude ?? p.latitude;
        const lng = visitPayload.longitude ?? p.longitude;
        await trpcClient.visits.addEvidence.mutate({
          visitId,
          evidenceUrl: serverUrl,
          latitude: lat !== undefined && lat !== null ? String(lat) : undefined,
          longitude: lng !== undefined && lng !== null ? String(lng) : undefined,
        });
      }
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "GPS_POINT": {
      const recordedDate = p.recordedDate || (p.capturedAt ? p.capturedAt.slice(0, 10) : new Date(op.createdAt).toISOString().slice(0, 10));
      await trpcClient.tracking.recordPoint.mutate({
        recordedDate,
        latitude: String(p.latitude),
        longitude: String(p.longitude),
        accuracy: p.accuracy !== undefined && p.accuracy !== null ? Math.round(Number(p.accuracy)) : undefined,
        address: p.address,
        operationId: op.operationId || p.operationId,
        capturedAt: p.capturedAt || op.createdAt,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "TASK_CREATE": {
      const assignedToUserId = typeof p.assignedToUserId === "number" ? p.assignedToUserId : parseInt(p.assignedToUserId, 10);
      if (isNaN(assignedToUserId) || assignedToUserId <= 0) {
        throw new SyncOperationError(`Invalid assignedToUserId: ${p.assignedToUserId}`, { status: 400, code: "BAD_REQUEST" });
      }
      await trpcClient.tasks.create.mutate({
        title: String(p.title),
        description: p.description,
        assignedToUserId,
        scheduledDate: p.scheduledDate || new Date().toISOString().slice(0, 10),
        priority: p.priority || "MEDIUM",
        locationLat: p.locationLat ? String(p.locationLat) : undefined,
        locationLng: p.locationLng ? String(p.locationLng) : undefined,
        locationAddress: p.locationAddress,
        customerName: p.customerName,
        operationId: op.operationId || p.operationId,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "TASK_UPDATE": {
      await trpcClient.tasks.updateStatus.mutate({
        taskId: String(p.taskId),
        status: p.status,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "CUSTOMER_CREATE": {
      await trpcClient.customers.create.mutate({
        name: String(p.name),
        phone: p.phone,
        email: p.email || undefined,
        address: p.address,
        latitude: p.latitude !== undefined && p.latitude !== null ? String(p.latitude) : undefined,
        longitude: p.longitude !== undefined && p.longitude !== null ? String(p.longitude) : undefined,
        notes: p.notes,
        operationId: op.operationId || p.operationId,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "CUSTOMER_UPDATE": {
      await trpcClient.customers.update.mutate({
        id: String(p.id),
        name: p.name,
        phone: p.phone,
        email: p.email,
        address: p.address,
        latitude: p.latitude !== undefined && p.latitude !== null ? String(p.latitude) : undefined,
        longitude: p.longitude !== undefined && p.longitude !== null ? String(p.longitude) : undefined,
        notes: p.notes,
        status: p.status,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "VISIT_CREATE": {
      const empId = p.employeeUserId !== undefined && p.employeeUserId !== null ? Number(p.employeeUserId) : undefined;
      await trpcClient.visits.create.mutate({
        customerId: String(p.customerId),
        employeeUserId: empId && !isNaN(empId) ? empId : undefined,
        scheduledFor: p.scheduledFor ? new Date(p.scheduledFor).toISOString() : new Date().toISOString(),
        notes: p.notes,
        operationId: op.operationId || p.operationId,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "VISIT_CHECK_IN": {
      await trpcClient.visits.checkIn.mutate({
        visitId: String(p.visitId),
        latitude: p.latitude !== undefined && p.latitude !== null ? String(p.latitude) : undefined,
        longitude: p.longitude !== undefined && p.longitude !== null ? String(p.longitude) : undefined,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "VISIT_UPDATE_NOTES": {
      await trpcClient.visits.updateNotes.mutate({
        visitId: String(p.visitId),
        meetingOutcome: p.meetingOutcome,
        notes: p.notes,
        followUpDate: p.followUpDate,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "VISIT_COMPLETE": {
      await trpcClient.visits.complete.mutate({
        visitId: String(p.visitId),
        latitude: p.latitude !== undefined && p.latitude !== null ? String(p.latitude) : undefined,
        longitude: p.longitude !== undefined && p.longitude !== null ? String(p.longitude) : undefined,
        meetingOutcome: p.meetingOutcome,
        notes: p.notes,
        followUpDate: p.followUpDate,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "VISIT_EVIDENCE": {
      await trpcClient.visits.addEvidence.mutate({
        visitId: String(p.visitId),
        evidenceUrl: String(p.evidenceUrl || p.photoUri),
        latitude: p.latitude !== undefined && p.latitude !== null ? String(p.latitude) : undefined,
        longitude: p.longitude !== undefined && p.longitude !== null ? String(p.longitude) : undefined,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "EXPENSE_CREATE": {
      await trpcClient.expenses.create.mutate({
        amount: Number(p.amount),
        category: String(p.category),
        description: p.description,
        receiptUrl: p.receiptUrl,
        expenseDate: p.expenseDate || new Date().toISOString().slice(0, 10),
        operationId: op.operationId || p.operationId,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "CHAT_MESSAGE": {
      let channelId = p.channelId;
      const targetUserId =
        p.targetUserId !== undefined && p.targetUserId !== null
          ? Number(p.targetUserId)
          : undefined;
      const message = String(p.message || p.text || "");

      if (!channelId && (!targetUserId || isNaN(targetUserId))) {
        throw new SyncOperationError("Cannot send chat message: both channelId and targetUserId are missing", {
          status: 400,
          code: "BAD_REQUEST",
        });
      }

      if (!channelId && targetUserId) {
        const channel = await trpcClient.chat.getOrCreateChannel.mutate({ targetUserId });
        if (channel?.id) {
          channelId = channel.id;
        } else {
          throw new SyncOperationError("Failed to resolve or create channel for target user", {
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
          });
        }
      }

      await trpcClient.chat.sendMessage.mutate({
        channelId: String(channelId),
        message,
        operationId: op.operationId || p.operationId,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    default: {
      console.warn(`[OfflineSync] Unknown operation type: ${(op as any).type}`);
      return false;
    }
  }
}
