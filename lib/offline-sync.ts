import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";

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
