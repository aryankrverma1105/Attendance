import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatDay, formatTime, useFieldData } from "@/lib/field-data";
import {
  getOfflineQueue,
  flushOfflineQueue,
  removeOperation,
  type QueuedOperation,
} from "@/lib/offline-sync";

const iconForType: Record<string, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  ATTENDANCE_CHECK_IN: "verified-user",
  ATTENDANCE_CHECK_OUT: "how-to-reg",
  GPS_POINT: "location-on",
  TASK_CREATE: "assignment",
  TASK_UPDATE: "task-alt",
  CUSTOMER_CREATE: "storefront",
  CUSTOMER_UPDATE: "edit-location",
  VISIT_CREATE: "event",
  VISIT_CHECK_IN: "where-to-vote",
  VISIT_COMPLETE: "check-circle",
  VISIT_EVIDENCE: "photo-camera",
  EXPENSE_CREATE: "payments",
  CHAT_MESSAGE: "forum",
};

export default function OfflineQueueScreen() {
  const router = useRouter();
  const { data } = useFieldData();
  const [durableQueue, setDurableQueue] = useState<QueuedOperation[]>([]);
  const [isFlushing, setIsFlushing] = useState(false);

  const loadQueue = async () => {
    const q = await getOfflineQueue();
    setDurableQueue(q);
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const handleSyncAll = async () => {
    setIsFlushing(true);
    try {
      const result = await flushOfflineQueue();
      await loadQueue();
      Alert.alert(
        "Sync completed",
        `Processed ${result.processed} operations: ${result.succeeded} succeeded, ${result.failed} pending.`
      );
    } catch (err: any) {
      Alert.alert("Sync notice", err?.message || "Could not complete full sync at this time.");
    } finally {
      setIsFlushing(false);
    }
  };

  const handleRemove = async (opId: string) => {
    await removeOperation(opId);
    await loadQueue();
  };

  const totalWaiting = durableQueue.length + data.offlineQueue.length;

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <MaterialIcons color="#547087" name="arrow-back" size={22} />
          </Pressable>
          <View>
            <Text style={styles.title}>Offline Queue</Text>
            <Text style={styles.subtitle}>Durable local operations protected before server dispatch.</Text>
          </View>
        </View>

        <Surface style={styles.status}>
          <View style={styles.statusIcon}>
            <MaterialIcons color="#17354A" name="security" size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>
              {totalWaiting === 0
                ? "Nothing waiting to synchronize"
                : `${totalWaiting} protected operation${totalWaiting === 1 ? "" : "s"} waiting`}
            </Text>
            <Text style={styles.statusBody}>
              Operations are stored in durable local storage with exponential backoff and idempotency protection.
            </Text>
          </View>
        </Surface>

        {durableQueue.length > 0 ? (
          <View style={styles.list}>
            {durableQueue.map((op) => (
              <Surface key={op.operationId} style={styles.operation}>
                <View style={styles.operationIcon}>
                  <MaterialIcons
                    color="#159FBE"
                    name={iconForType[op.type] || "sync"}
                    size={20}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.operationTitle}>
                    {op.type.replace(/_/g, " ")}
                  </Text>
                  <Text style={styles.operationMeta}>
                    {formatDay(op.createdAt)} · {formatTime(op.createdAt)} · Attempts: {op.attemptCount}
                  </Text>
                  {op.error ? (
                    <Text style={styles.errorText}>Reason: {op.error}</Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <StatusChip
                    label={op.status === "dead_letter" ? "Needs review" : op.status === "syncing" ? "Syncing" : "Queued"}
                    tone={op.status === "dead_letter" ? "danger" : op.status === "syncing" ? "solar" : "warning"}
                  />
                  {op.status === "dead_letter" ? (
                    <Pressable onPress={() => handleRemove(op.operationId)} style={styles.discardBtn}>
                      <Text style={styles.discardText}>Discard</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Surface>
            ))}
          </View>
        ) : totalWaiting === 0 ? (
          <Surface style={styles.empty}>
            <MaterialIcons color="#22B573" name="cloud-done" size={34} />
            <Text style={styles.emptyTitle}>Your local queue is clear.</Text>
            <Text style={styles.emptyBody}>
              All field attendance, customer visits, GPS points, and messages are synchronized with Cloud SQL.
            </Text>
          </Surface>
        ) : null}

        {totalWaiting > 0 ? (
          <FieldButton
            disabled={isFlushing}
            icon="sync"
            label={isFlushing ? "Flushing queue…" : "Synchronize now"}
            onPress={handleSyncAll}
          />
        ) : (
          <FieldButton
            icon="sync"
            label="Check connection status"
            onPress={() => router.push("/track")}
            variant="secondary"
          />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 18, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EBF0", alignItems: "center", justifyContent: "center" },
  title: { color: "#17354A", fontSize: 23, fontWeight: "900" },
  subtitle: { color: "#7E96A9", fontSize: 12, marginTop: 3 },
  status: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: "#EAF9F8", borderColor: "#C6ECE8" },
  statusIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#DDF8F5", justifyContent: "center", alignItems: "center" },
  statusTitle: { color: "#17354A", fontSize: 14, fontWeight: "800" },
  statusBody: { color: "#547087", fontSize: 12, lineHeight: 18, marginTop: 4 },
  list: { gap: 10 },
  operation: { flexDirection: "row", alignItems: "center", gap: 11, padding: 13 },
  operationIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: "#F0F7FA", alignItems: "center", justifyContent: "center" },
  operationTitle: { color: "#17354A", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  operationMeta: { color: "#7E96A9", fontSize: 11, marginTop: 3 },
  errorText: { color: "#DC2626", fontSize: 10, marginTop: 2 },
  discardBtn: { paddingVertical: 2, paddingHorizontal: 6 },
  discardText: { color: "#DC2626", fontSize: 10, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 36, gap: 10 },
  emptyTitle: { color: "#17354A", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#7E96A9", fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 270 },
});
