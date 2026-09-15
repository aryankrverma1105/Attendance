import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  enqueueOperation,
  getOfflineQueue,
  updateOperationStatus,
  removeOperation,
  flushOfflineQueue,
  getExponentialBackoffMs,
  type QueuedOperation,
} from "../lib/offline-sync";

// Mock AsyncStorage in-memory
const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) || null),
    setItem: vi.fn(async (key: string, val: string) => {
      storage.set(key, val);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(async () => {
      storage.clear();
    }),
  },
}));

vi.mock("expo-network", () => ({
  getNetworkStateAsync: vi.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
  })),
}));

describe("Offline Synchronization Engine", () => {
  beforeEach(() => {
    storage.clear();
  });

  it("enqueues operations with durable fields and priority ordering", async () => {
    const op1 = await enqueueOperation("TASK_UPDATE", { taskId: "t1", status: "COMPLETED" }, "normal");
    expect(op1.operationId).toBeDefined();
    expect(op1.status).toBe("queued");
    expect(op1.attemptCount).toBe(0);

    // High priority is placed at head of queue
    const op2 = await enqueueOperation("ATTENDANCE_CHECK_IN", { lat: "28.5", lng: "77.2" }, "high");

    const queue = await getOfflineQueue();
    expect(queue.length).toBe(2);
    expect(queue[0].operationId).toBe(op2.operationId);
    expect(queue[1].operationId).toBe(op1.operationId);
  });

  it("calculates exponential backoff with ceiling cap", () => {
    expect(getExponentialBackoffMs(0)).toBe(1000);
    expect(getExponentialBackoffMs(1)).toBe(2000);
    expect(getExponentialBackoffMs(2)).toBe(4000);
    expect(getExponentialBackoffMs(3)).toBe(8000);
    expect(getExponentialBackoffMs(4)).toBe(16000);
    expect(getExponentialBackoffMs(5)).toBe(30000); // capped at 30s
    expect(getExponentialBackoffMs(10)).toBe(30000);
  });

  it("flushes queue successfully when sync handler succeeds", async () => {
    await enqueueOperation("CUSTOMER_CREATE", { name: "Client A" });
    await enqueueOperation("CHAT_MESSAGE", { text: "Hello Manager" });

    const handler = vi.fn(async (_op: QueuedOperation) => true);
    const result = await flushOfflineQueue(handler);

    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);

    const remaining = await getOfflineQueue();
    expect(remaining.length).toBe(0);
  });

  it("increments attemptCount on failure and transitions to dead_letter after max attempts", async () => {
    await enqueueOperation("VISIT_COMPLETE", { visitId: "v1" });

    const failingHandler = vi.fn(async (_op: QueuedOperation) => false);

    // Run 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await flushOfflineQueue(failingHandler);
    }

    const queue = await getOfflineQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].attemptCount).toBe(5);
    expect(queue[0].status).toBe("dead_letter");
  });

  it("handles multi-entity queue persistence across simulated app restart and partial failure", async () => {
    // 1-8: User performs actions offline
    const checkInOp = await enqueueOperation("ATTENDANCE_CHECK_IN", { lat: "28.5", lng: "77.2" }, "high");
    const taskOp = await enqueueOperation("TASK_UPDATE", { taskId: "t-1", status: "COMPLETED" }, "normal");
    const customerOp = await enqueueOperation("CUSTOMER_CREATE", { name: "Solar Site Alpha" }, "normal");
    const visitOp = await enqueueOperation("VISIT_COMPLETE", { visitId: "v-101" }, "normal");
    const evidenceOp = await enqueueOperation("VISIT_EVIDENCE", { visitId: "v-101", uri: "selfie.jpg" }, "normal");
    const gpsOp = await enqueueOperation("GPS_POINT", { lat: 28.51, lng: 77.21 }, "low");

    // 9-12: App killed & restarted (verify queue survives in storage)
    const restoredQueue = await getOfflineQueue();
    expect(restoredQueue.length).toBe(6);
    expect(restoredQueue.map((o) => o.operationId)).toContain(checkInOp.operationId);
    expect(restoredQueue.map((o) => o.operationId)).toContain(taskOp.operationId);
    expect(restoredQueue.map((o) => o.operationId)).toContain(customerOp.operationId);

    // 13-15: Network restored, partial failure simulation
    // Let customerOp fail once, while all others succeed
    const mockSyncHandler = vi.fn(async (op: QueuedOperation) => {
      if (op.operationId === customerOp.operationId) {
        return false; // network glitch on customer creation
      }
      return true; // all others succeed
    });

    const result = await flushOfflineQueue(mockSyncHandler);
    expect(result.processed).toBe(6);
    expect(result.succeeded).toBe(5);
    expect(result.failed).toBe(1);

    // Only customerOp remains in queue
    const remainingQueue = await getOfflineQueue();
    expect(remainingQueue.length).toBe(1);
    expect(remainingQueue[0].operationId).toBe(customerOp.operationId);
    expect(remainingQueue[0].attemptCount).toBe(1);

    // Re-flush with fixed network -> 100% drained
    const secondSyncHandler = vi.fn(async (_op: QueuedOperation) => true);
    const secondResult = await flushOfflineQueue(secondSyncHandler);
    expect(secondResult.succeeded).toBe(1);

    const finalQueue = await getOfflineQueue();
    expect(finalQueue.length).toBe(0);
  });
});
