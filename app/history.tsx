import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatDay, formatTime, useFieldData } from "@/lib/field-data";

export default function AttendanceHistoryScreen() {
  const router = useRouter();
  const { data } = useFieldData();

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back}><MaterialIcons color="#547087" name="arrow-back" size={22} /></Pressable><View><Text style={styles.title}>Attendance history</Text><Text style={styles.subtitle}>GPS, photo, timestamp, and sync evidence.</Text></View></View>
        {data.attendance.length === 0 ? (
          <Surface style={styles.empty}><MaterialIcons color="#159FBE" name="history" size={32} /><Text style={styles.emptyTitle}>No attendance evidence yet.</Text><Text style={styles.emptyBody}>Your check-ins and check-outs will appear here with verification and sync state.</Text></Surface>
        ) : (
          <>
            <SectionHeading title="Latest records" />
            <View style={styles.list}>
              {data.attendance.map((record) => (
                <Surface key={record.id} style={styles.record}>
                  <View style={styles.recordTop}><View><Text style={styles.day}>{formatDay(record.checkInAt)}</Text><Text style={styles.time}>{formatTime(record.checkInAt)} → {formatTime(record.checkOutAt)}</Text></View><StatusChip label={record.status === "verified" ? "GPS verified" : record.status === "review" ? "Review location" : "Awaiting review"} tone={record.status === "verified" ? "success" : "warning"} /></View>
                  <View style={styles.recordDetails}>
                    {record.checkInPhotoUri ? <Image source={{ uri: record.checkInPhotoUri }} style={styles.photo} /> : <View style={styles.photoFallback}><MaterialIcons color="#159FBE" name="camera-alt" size={20} /></View>}
                    <View style={styles.detailCopy}><Text style={styles.detailTitle}>{record.lateEarlyLabel}</Text><Text style={styles.detailBody}>GPS accuracy: {record.checkInLocation?.accuracy !== null && record.checkInLocation?.accuracy !== undefined ? `±${Math.round(record.checkInLocation.accuracy)} m` : "not available"}</Text><Text style={styles.detailBody}>Sync: {record.syncState === "synced" ? "complete" : "awaiting secure server sync"}</Text></View>
                  </View>
                </Surface>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 20, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EBF0", justifyContent: "center", alignItems: "center" },
  title: { color: "#17354A", fontSize: 23, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: "#7E96A9", fontSize: 12, marginTop: 4 },
  empty: { alignItems: "center", paddingVertical: 42, gap: 10 },
  emptyTitle: { color: "#17354A", fontSize: 17, fontWeight: "800" },
  emptyBody: { color: "#7E96A9", lineHeight: 19, fontSize: 13, textAlign: "center", maxWidth: 280 },
  list: { gap: 12 },
  record: { gap: 14 },
  recordTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  day: { color: "#17354A", fontSize: 16, fontWeight: "800" },
  time: { color: "#7E96A9", fontSize: 12, marginTop: 5 },
  recordDetails: { flexDirection: "row", gap: 12, alignItems: "center" },
  photo: { width: 54, height: 54, borderRadius: 17, backgroundColor: "#EAF3F7" },
  photoFallback: { width: 54, height: 54, borderRadius: 17, backgroundColor: "#F0F7FA", justifyContent: "center", alignItems: "center" },
  detailCopy: { flex: 1, gap: 3 },
  detailTitle: { color: "#17354A", fontSize: 14, fontWeight: "800" },
  detailBody: { color: "#7E96A9", fontSize: 12 },
});
