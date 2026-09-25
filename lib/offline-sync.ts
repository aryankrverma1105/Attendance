import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { trpcClient } from "@/lib/trpc";

export type OperationType =
  | "ATTENDANCE_CHECK_IN"
  | "ATTENDANCE_CHECK_OUT"
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

const OFFLINE_QUEUE_STORAGE_KEY = "@fieldpulse_offline_queue_v2";
const MAX_RETRY_ATTEMPTS = 5;

function generateOperationId(type: string): string {
  return `op_${type.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load queue from persistent device storage.
 */
export async function getOfflineQueue(): Promise<QueuedOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
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
    await AsyncStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error("[OfflineSync] Failed to save queue:", err);
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

/**
 * Flush all pending queue operations using the provided handler.
 */
export async function flushOfflineQueue(
  handler: OperationSyncHandler
): Promise<{ processed: number; succeeded: number; failed: number }> {
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
      attemptCount: op.attemptCount + 1,
    });

    try {
      const success = await handler(op);
      if (success) {
        await removeOperation(op.operationId);
        succeeded++;
      } else {
        const nextAttempts = op.attemptCount + 1;
        await updateOperationStatus(op.operationId, {
          status: nextAttempts >= MAX_RETRY_ATTEMPTS ? "dead_letter" : "failed",
          error: "Server rejected or unhandled response",
        });
        failed++;
      }
    } catch (err: any) {
      const nextAttempts = op.attemptCount + 1;
      await updateOperationStatus(op.operationId, {
        status: nextAttempts >= MAX_RETRY_ATTEMPTS ? "dead_letter" : "failed",
        error: err?.message || String(err),
      });
      failed++;
    }
  }

  return { processed: pending.length, succeeded, failed };
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
 * Returns true only on confirmed server success; throws/returns false on failure.
 */
export async function dispatchQueuedOperation(op: QueuedOperation): Promise<boolean> {
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
        targetLat: p.targetLat ? String(p.targetLat) : undefined,
        targetLng: p.targetLng ? String(p.targetLng) : undefined,
        geofenceRadiusMeters: p.geofenceRadiusMeters !== undefined && p.geofenceRadiusMeters !== null ? Number(p.geofenceRadiusMeters) : undefined,
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

    case "GPS_POINT": {
      const recordedDate = p.recordedDate || (p.capturedAt ? p.capturedAt.slice(0, 10) : new Date(op.createdAt).toISOString().slice(0, 10));
      await trpcClient.tracking.recordPoint.mutate({
        recordedDate,
        latitude: String(p.latitude),
        longitude: String(p.longitude),
        accuracy: p.accuracy !== undefined && p.accuracy !== null ? Math.round(Number(p.accuracy)) : undefined,
        address: p.address,
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "TASK_CREATE": {
      const assignedToUserId = typeof p.assignedToUserId === "number" ? p.assignedToUserId : parseInt(p.assignedToUserId, 10);
      if (isNaN(assignedToUserId) || assignedToUserId <= 0) {
        throw new Error(`Invalid assignedToUserId: ${p.assignedToUserId}`);
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
      });
      await markRecordSyncedInStorage(op);
      return true;
    }

    case "CHAT_MESSAGE": {
      let channelId = p.channelId;
      if (!channelId) {
        const channel = await trpcClient.chat.getOrCreateChannel.mutate({ targetUserId: 1 });
        channelId = channel?.id;
      }
      if (!channelId) throw new Error("Could not resolve chat channel");
      await trpcClient.chat.sendMessage.mutate({
        channelId,
        message: String(p.message || p.text),
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
