import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatDay, formatTime, useFieldData } from "@/lib/field-data";

const iconFor = { attendance: "verified-user", visit: "where-to-vote", customer: "groups", message: "forum", media: "photo-camera", account: "person-add", alert: "location-off" } as const;

export default function OfflineQueueScreen() {
  const router = useRouter();
  const { data } = useFieldData();

  return <ScreenContainer containerClassName="bg-background" className="flex-1"><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back}><MaterialIcons color="#547087" name="arrow-back" size={22} /></Pressable><View><Text style={styles.title}>Offline queue</Text><Text style={styles.subtitle}>Local work is stored before it reaches the server.</Text></View></View><Surface style={styles.status}><View style={styles.statusIcon}><MaterialIcons color="#17354A" name="security" size={22} /></View><View style={{ flex: 1 }}><Text style={styles.statusTitle}>{data.offlineQueue.length === 0 ? "Nothing waiting to synchronize" : `${data.offlineQueue.length} protected operation${data.offlineQueue.length === 1 ? "" : "s"} waiting`}</Text><Text style={styles.statusBody}>When a configured secure connection is available, operations are submitted with idempotency keys to reduce duplicate records.</Text></View></Surface>{data.offlineQueue.length > 0 ? <View style={styles.list}>{data.offlineQueue.map((operation) => <Surface key={operation.id} style={styles.operation}><View style={styles.operationIcon}><MaterialIcons color="#159FBE" name={iconFor[operation.category]} size={20} /></View><View style={{ flex: 1 }}><Text style={styles.operationTitle}>{operation.title}</Text><Text style={styles.operationMeta}>{formatDay(operation.createdAt)} · {formatTime(operation.createdAt)}</Text></View><StatusChip label={operation.status === "conflict" ? "Needs review" : "Queued"} tone={operation.status === "conflict" ? "danger" : "warning"} /></Surface>)}</View> : <Surface style={styles.empty}><MaterialIcons color="#22B573" name="cloud-done" size={34} /><Text style={styles.emptyTitle}>Your local queue is clear.</Text><Text style={styles.emptyBody}>Future attendance, visits, forms, photos, and messages will remain usable offline and appear here until synchronized.</Text></Surface>}<FieldButton icon="sync" label="Check connection status" onPress={() => router.push("/track")} variant="secondary" /></ScrollView></ScreenContainer>;
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
  empty: { alignItems: "center", paddingVertical: 36, gap: 10 },
  emptyTitle: { color: "#17354A", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#7E96A9", fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 270 },
});
