import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  enqueueOperation,
  getOfflineQueue,
  updateOperationStatus,
  removeOperation,
  flushOfflineQueue,
  getExponentialBackoffMs,
  resetStuckSyncingOperations,
  dispatchQueuedOperation,
  isQueuePaused,
  resumeQueue,
  SyncOperationError,
  type QueuedOperation,
} from "../lib/offline-sync";
import { trpcClient } from "@/lib/trpc";

vi.mock("@/constants/oauth", () => ({
  getApiBaseUrl: vi.fn(() => "https://api.example.com"),
}));

vi.mock("@/lib/_core/auth", () => ({
  getSessionToken: vi.fn(async () => "test-token"),
}));

// Mock trpcClient
vi.mock("@/lib/trpc", () => ({
  trpcClient: {
    attendance: {
      checkIn: { mutate: vi.fn(async () => ({ id: "att-mock-1", status: "verified" })) },
      checkOut: { mutate: vi.fn(async () => ({ success: true })) },
    },
    tracking: {
      recordPoint: { mutate: vi.fn(async () => ({ id: "point-mock-1" })) },
    },
    tasks: {
      create: { mutate: vi.fn(async () => ({ id: "task-mock-1" })) },
      updateStatus: { mutate: vi.fn(async () => ({ success: true })) },
    },
    customers: {
      create: { mutate: vi.fn(async () => ({ id: "cust-mock-1" })) },
      update: { mutate: vi.fn(async () => ({ success: true })) },
    },
    visits: {
      create: { mutate: vi.fn(async () => ({ id: "visit-mock-1" })) },
      checkIn: { mutate: vi.fn(async () => ({ success: true })) },
      updateNotes: { mutate: vi.fn(async () => ({ success: true })) },
      complete: { mutate: vi.fn(async () => ({ success: true })) },
      addEvidence: { mutate: vi.fn(async () => ({ id: "evidence-mock-1" })) },
    },
    expenses: {
      create: { mutate: vi.fn(async () => ({ id: "expense-mock-1" })) },
    },
    chat: {
      getOrCreateChannel: { mutate: vi.fn(async () => ({ id: "chan-mock-1" })) },
      sendMessage: { mutate: vi.fn(async () => ({ id: "msg-mock-1" })) },
    },
  },
}));

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

  it("resets stuck syncing operations to failed on startup", async () => {
    const op = await enqueueOperation("TASK_UPDATE", { taskId: "t-stuck", status: "IN_PROGRESS" });
    await updateOperationStatus(op.operationId, { status: "syncing" });

    const beforeReset = await getOfflineQueue();
    expect(beforeReset[0].status).toBe("syncing");

    const resetCount = await resetStuckSyncingOperations();
    expect(resetCount).toBe(1);

    const afterReset = await getOfflineQueue();
    expect(afterReset[0].status).toBe("failed");
    expect(afterReset[0].error).toContain("Interrupted");
  });

  it("dispatches queued operations to matching tRPC procedures", async () => {
    const checkInOp = await enqueueOperation("ATTENDANCE_CHECK_IN", {
      checkInPhotoUri: "photo.jpg",
      checkInLat: "28.6",
      checkInLng: "77.2",
      checkInAccuracy: 10,
    });
    const taskCreateOp = await enqueueOperation("TASK_CREATE", {
      title: "Inspect Inverter",
      assignedToUserId: 5,
      scheduledDate: "2026-09-18",
    });
    const visitNotesOp = await enqueueOperation("VISIT_UPDATE_NOTES", {
      visitId: "v-1",
      notes: "Customer confirmed installation date",
      meetingOutcome: "Agreed",
    });
    const chatOp = await enqueueOperation("CHAT_MESSAGE", {
      channelId: "chan-1",
      message: "On site now",
    });

    expect(await dispatchQueuedOperation(checkInOp)).toBe(true);
    expect(await dispatchQueuedOperation(taskCreateOp)).toBe(true);
    expect(await dispatchQueuedOperation(visitNotesOp)).toBe(true);
    expect(await dispatchQueuedOperation(chatOp)).toBe(true);

    // Drain entire queue with dispatchQueuedOperation
    const flushResult = await flushOfflineQueue(dispatchQueuedOperation);
    expect(flushResult.failed).toBe(0);
    expect(flushResult.succeeded).toBe(4);

    const remaining = await getOfflineQueue();
    expect(remaining.length).toBe(0);
  });

  it("flips record syncState in storage to synced when dispatchQueuedOperation succeeds", async () => {
    const initialWorkspace = {
      tasks: [{ id: "task-offline-1", title: "Task 1", syncState: "awaiting-server" }],
      customers: [{ id: "cust-offline-1", name: "Cust 1", syncState: "awaiting-server" }],
      visits: [{ id: "visit-offline-1", customerId: "c1", syncState: "awaiting-server" }],
      attendance: [{ id: "att-offline-1", checkInAt: "2026-09-22T08:00:00.000Z", syncState: "awaiting-server" }],
    };
    storage.set("fieldpulse.workspace.v1", JSON.stringify(initialWorkspace));

    const taskOp = await enqueueOperation("TASK_UPDATE", { taskId: "task-offline-1", status: "COMPLETED" });
    expect(await dispatchQueuedOperation(taskOp)).toBe(true);

    const updatedWorkspace = JSON.parse(storage.get("fieldpulse.workspace.v1")!);
    expect(updatedWorkspace.tasks[0].syncState).toBe("synced");
  });

  it("throws typed SyncOperationError and dead-letters CHAT_MESSAGE when channelId and targetUserId are both missing", async () => {
    const chatOp = await enqueueOperation("CHAT_MESSAGE", { message: "orphan message" });
    await expect(dispatchQueuedOperation(chatOp)).rejects.toThrow(SyncOperationError);

    const flushResult = await flushOfflineQueue(dispatchQueuedOperation);
    expect(flushResult.failed).toBe(1);

    const queue = await getOfflineQueue();
    expect(queue[0].status).toBe("dead_letter");
    expect(queue[0].error).toContain("BAD_REQUEST");
  });

  it("offline chat message with only targetUserId syncs", async () => {
    const getOrCreateChannelMock = vi.fn(async () => ({ id: "resolved-chan-42" }));
    const sendMessageMock = vi.fn(async () => ({ id: "msg-999" }));
    (trpcClient.chat.getOrCreateChannel as any).mutate = getOrCreateChannelMock;
    (trpcClient.chat.sendMessage as any).mutate = sendMessageMock;

    const chatOp = await enqueueOperation("CHAT_MESSAGE", {
      targetUserId: 42,
      message: "Hello manager via offline queue",
    });

    const success = await dispatchQueuedOperation(chatOp);
    expect(success).toBe(true);
    expect(getOrCreateChannelMock).toHaveBeenCalledWith({ targetUserId: 42 });
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "resolved-chan-42",
        message: "Hello manager via offline queue",
      })
    );
  });

  it("a NOT_FOUND mutation is dead-lettered on attempt 1", async () => {
    await enqueueOperation("TASK_UPDATE", { taskId: "non-existent-task", status: "COMPLETED" });

    const notFoundHandler = vi.fn(async () => {
      throw new SyncOperationError("Task not found", { status: 404, code: "NOT_FOUND" });
    });

    const flushResult = await flushOfflineQueue(notFoundHandler);
    expect(flushResult.failed).toBe(1);

    const queue = await getOfflineQueue();
    expect(queue[0].status).toBe("dead_letter");
    expect(queue[0].attemptCount).toBe(0);
    expect(queue[0].error).toContain("NOT_FOUND");
  });

  it("handles UPLOAD_SELFIE -> VISIT_EVIDENCE calling visits.addEvidence with evidenceUrl", async () => {
    const mockVisitEvidenceMutate = vi.fn(async () => ({ id: "ev-100" }));
    (trpcClient.visits.addEvidence as any).mutate = mockVisitEvidenceMutate;

    // Mock global fetch for selfie upload
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://cdn.fieldpulse.app/evidence-photo.jpg" }),
    })) as any;

    try {
      const uploadEvidenceOp = await enqueueOperation("UPLOAD_SELFIE", {
        base64: "base64data",
        action: "visit-evidence",
        nextAction: "VISIT_EVIDENCE",
        visitPayload: {
          visitId: "visit-999",
          latitude: "28.6139",
          longitude: "77.2090",
        },
      });

      const success = await dispatchQueuedOperation(uploadEvidenceOp);
      expect(success).toBe(true);

      expect(mockVisitEvidenceMutate).toHaveBeenCalledWith({
        visitId: "visit-999",
        evidenceUrl: "https://cdn.fieldpulse.app/evidence-photo.jpg",
        latitude: "28.6139",
        longitude: "77.2090",
      });
      // Verify photoUri is NOT sent
      expect((mockVisitEvidenceMutate.mock.calls as any)[0][0]).not.toHaveProperty("photoUri");
    } finally {
      global.fetch = originalFetch;
    }
  });

  describe("Error Classification and Queue Pause Logic", () => {
    beforeEach(() => {
      resumeQueue();
    });

    it("pauses queue on 401 or UNAUTHORIZED without dead-lettering, and resumeQueue unpauses", async () => {
      await enqueueOperation("TASK_UPDATE", { taskId: "t-auth", status: "DONE" });

      const authErrorHandler = vi.fn(async () => {
        throw new SyncOperationError("Unauthorized session", { status: 401, code: "UNAUTHORIZED" });
      });

      expect(isQueuePaused()).toBe(false);
      await flushOfflineQueue(authErrorHandler);

      expect(isQueuePaused()).toBe(true);
      const queue = await getOfflineQueue();
      expect(queue[0].status).toBe("queued");
      expect(queue[0].attemptCount).toBe(0); // Not incremented

      // Queue is paused: subsequent flush returns immediately
      const skippedFlush = await flushOfflineQueue(authErrorHandler);
      expect(skippedFlush.processed).toBe(0);

      // Calling resumeQueue unpauses
      resumeQueue();
      expect(isQueuePaused()).toBe(false);
    });

    it("pauses queue on REST 403 with auth message", async () => {
      await enqueueOperation("TASK_UPDATE", { taskId: "t-rest-auth", status: "DONE" });

      const restAuthHandler = vi.fn(async () => {
        throw new SyncOperationError("Forbidden: token expired", { status: 403, isRestAuthMessage: true });
      });

      await flushOfflineQueue(restAuthHandler);
      expect(isQueuePaused()).toBe(true);

      const queue = await getOfflineQueue();
      expect(queue[0].status).toBe("queued");
    });

    it("dead-letters client errors (400, 403, BAD_REQUEST, FORBIDDEN) immediately", async () => {
      await enqueueOperation("TASK_UPDATE", { taskId: "t-bad", status: "INVALID" });

      const badRequestHandler = vi.fn(async () => {
        throw new SyncOperationError("Validation failed", { status: 400, code: "BAD_REQUEST" });
      });

      await flushOfflineQueue(badRequestHandler);

      const queue = await getOfflineQueue();
      expect(queue[0].status).toBe("dead_letter");
      expect(queue[0].error).toContain("BAD_REQUEST");
      expect(isQueuePaused()).toBe(false);
    });

    it("retries server 5xx and network errors with backoff", async () => {
      await enqueueOperation("TASK_UPDATE", { taskId: "t-server-err", status: "DONE" });

      const serverErrorHandler = vi.fn(async () => {
        throw new SyncOperationError("Internal server error", { status: 500, code: "INTERNAL_SERVER_ERROR" });
      });

      await flushOfflineQueue(serverErrorHandler);

      const queue = await getOfflineQueue();
      expect(queue[0].status).toBe("failed");
      expect(queue[0].attemptCount).toBe(1);
      expect(isQueuePaused()).toBe(false);
    });
  });
});
