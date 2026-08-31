import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatTime, useFieldData } from "@/lib/field-data";
import { canViewGpsHistory } from "@/lib/field-access";
import { trpc } from "@/lib/trpc";

export default function LocationHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ employeeId?: string; date?: string }>();
  const { data } = useFieldData();

  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(params.date || todayStr);

  const currentRole = data.session?.role;
  const currentUserId = data.session?.id;

  // Determine target employee
  const targetEmployeeId = params.employeeId || currentUserId || "1";
  const targetUser = data.managedUsers.find((u) => u.id === targetEmployeeId);
  const targetName = targetUser?.displayName || (targetEmployeeId === currentUserId ? data.session?.displayName : "Employee") || "Field Engineer";

  // Authorization check
  const isAllowed = canViewGpsHistory({
    viewerRole: currentRole,
    viewerId: currentUserId,
    targetUserId: targetEmployeeId,
    targetManagerId: targetUser?.managerId,
  });

  // Calculate local points for selected date
  const localPoints = useMemo(() => {
    return data.routePoints.filter((pt) => {
      const isTarget = !pt.employeeId || pt.employeeId === targetEmployeeId;
      const isDate = pt.capturedAt?.startsWith(selectedDate);
      return isTarget && isDate;
    });
  }, [data.routePoints, targetEmployeeId, selectedDate]);

  // Fetch server-side day route history
  const numericTargetId = parseInt(targetEmployeeId, 10);
  const serverQuery = trpc.tracking.getDayRouteHistory.useQuery(
    { targetUserId: isNaN(numericTargetId) ? 1 : numericTargetId, recordedDate: selectedDate },
    { enabled: !isNaN(numericTargetId) && isAllowed }
  );

  // Available dates for quick selector (last 7 days)
  const pastDates = useMemo(() => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }, []);

  const waypoints = useMemo(() => {
    if (serverQuery.data?.points && serverQuery.data.points.length > 0) {
      return serverQuery.data.points.map((p) => ({
        id: p.id,
        timeFormatted: formatTime(p.recordedAt.toString()),
        latitude: parseFloat(p.latitude),
        longitude: parseFloat(p.longitude),
        accuracy: p.accuracy,
        address: p.address || `${p.latitude.slice(0, 7)}°, ${p.longitude.slice(0, 7)}°`,
      }));
    }
    return localPoints.map((pt, idx) => ({
      id: pt.id || `pt-${idx}`,
      timeFormatted: formatTime(pt.capturedAt),
      latitude: pt.latitude,
      longitude: pt.longitude,
      accuracy: pt.accuracy,
      address: `${pt.latitude.toFixed(5)}°, ${pt.longitude.toFixed(5)}°`,
    }));
  }, [serverQuery.data, localPoints]);

  if (!isAllowed) {
    return (
      <ScreenContainer containerClassName="bg-background" className="p-4 justify-center items-center">
        <Surface style={styles.deniedCard}>
          <MaterialIcons color="#DC2626" name="gpp-bad" size={40} />
          <Text style={styles.deniedTitle}>Access Restricted</Text>
          <Text style={styles.deniedBody}>
            You are not authorized to view GPS location history for this employee.
          </Text>
          <FieldButton label="Go back" onPress={() => router.back()} style={{ marginTop: 12 }} variant="primary" />
        </Surface>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      {/* Sunlight High-Contrast Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons color="#0F172A" name="arrow-back" size={20} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={styles.kickerRow}>
            <MaterialIcons color="#D97706" name="route" size={14} />
            <Text style={styles.kicker}>DAY-WISE GPS PLAYBACK</Text>
          </View>
          <Text style={styles.title}>{targetName}</Text>
          <Text style={styles.subtitle}>Route trail and verified location points</Text>
        </View>
      </View>

      <View style={styles.content}>
        {/* Date Selector Pills */}
        <View style={styles.dateSelectorContainer}>
          <Text style={styles.dateSelectorLabel}>SELECT DATE:</Text>
          <FlatList
            data={pastDates}
            horizontal
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const isSelected = item === selectedDate;
              const dateObj = new Date(item);
              const label = item === todayStr ? "Today" : `${dateObj.getDate()} ${dateObj.toLocaleString("default", { month: "short" })}`;
              return (
                <Pressable
                  onPress={() => setSelectedDate(item)}
                  style={[styles.datePill, isSelected && styles.datePillSelected]}
                >
                  <Text style={[styles.datePillText, isSelected && styles.datePillTextSelected]}>
                    {label}
                  </Text>
                  <Text style={[styles.datePillSub, isSelected && styles.datePillSubSelected]}>
                    {item}
                  </Text>
                </Pressable>
              );
            }}
            showsHorizontalScrollIndicator={false}
          />
        </View>

        {/* Route Stats Summary Card */}
        <Surface style={styles.summarySurface}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNumber}>{waypoints.length}</Text>
              <Text style={styles.summaryLabel}>GPS WAYPOINTS</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNumber}>
                {waypoints.length > 1 ? `${((waypoints.length * 0.45)).toFixed(1)} km` : "0.0 km"}
              </Text>
              <Text style={styles.summaryLabel}>EST. DISTANCE</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <StatusChip
                label={waypoints.length > 0 ? "RECORDED" : "NO DATA"}
                tone={waypoints.length > 0 ? "success" : "neutral"}
              />
            </View>
          </View>
        </Surface>

        {/* Chronological Waypoint Timeline */}
        <SectionHeading
          subtitle={`${waypoints.length} recorded waypoints on ${selectedDate}`}
          title="Route timeline"
        />

        {waypoints.length === 0 ? (
          <Surface style={styles.emptyCard}>
            <MaterialIcons color="#D97706" name="location-off" size={32} />
            <Text style={styles.emptyTitle}>No GPS points for this date</Text>
            <Text style={styles.emptyBody}>
              No verified location coordinates were logged on {selectedDate}. Select another date to inspect historical trails.
            </Text>
          </Surface>
        ) : (
          <FlatList
            data={waypoints}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <View style={styles.timelineItem}>
                <View style={styles.timelineLeft}>
                  <View style={styles.timelineDot}>
                    <MaterialIcons
                      color="#D97706"
                      name={index === 0 ? "place" : index === waypoints.length - 1 ? "flag" : "navigation"}
                      size={14}
                    />
                  </View>
                  {index < waypoints.length - 1 ? <View style={styles.timelineLine} /> : null}
                </View>
                <Surface style={styles.timelineContent}>
                  <View style={styles.pointHeader}>
                    <Text style={styles.pointTime}>{item.timeFormatted}</Text>
                    {item.accuracy ? (
                      <Text style={styles.pointAccuracy}>±{item.accuracy}m accuracy</Text>
                    ) : null}
                  </View>
                  <Text style={styles.pointCoords}>
                    {item.latitude.toFixed(6)}° N, {item.longitude.toFixed(6)}° E
                  </Text>
                  <Text style={styles.pointAddress}>{item.address}</Text>
                </Surface>
              </View>
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  kicker: { color: "#D97706", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "#0F172A", fontSize: 20, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: "#334155", fontSize: 12, marginTop: 1 },
  content: { flex: 1, padding: 16, gap: 14 },
  dateSelectorContainer: { gap: 6 },
  dateSelectorLabel: { color: "#D97706", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  datePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginRight: 8,
    alignItems: "center",
  },
  datePillSelected: {
    backgroundColor: "#FFFBEB",
    borderColor: "#D97706",
  },
  datePillText: { color: "#334155", fontSize: 13, fontWeight: "800" },
  datePillTextSelected: { color: "#D97706", fontWeight: "900" },
  datePillSub: { color: "#64748B", fontSize: 10, marginTop: 2 },
  datePillSubSelected: { color: "#B45309", fontWeight: "700" },
  summarySurface: {
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
  },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  summaryItem: { alignItems: "center", gap: 2 },
  summaryNumber: { color: "#0F172A", fontSize: 20, fontWeight: "900" },
  summaryLabel: { color: "#64748B", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  summaryDivider: { width: 1, height: 28, backgroundColor: "#E2E8F0" },
  timelineItem: { flexDirection: "row", gap: 12, marginBottom: 12 },
  timelineLeft: { alignItems: "center", width: 24 },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    borderWidth: 1.5,
    borderColor: "#D97706",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineLine: { flex: 1, width: 2, backgroundColor: "#FDE68A", marginTop: 4 },
  timelineContent: { flex: 1, padding: 12, backgroundColor: "#FFFFFF", borderColor: "#E2E8F0" },
  pointHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pointTime: { color: "#0F172A", fontSize: 13, fontWeight: "900" },
  pointAccuracy: { color: "#059669", fontSize: 11, fontWeight: "700" },
  pointCoords: { color: "#D97706", fontSize: 12, fontWeight: "800", marginTop: 4 },
  pointAddress: { color: "#475569", fontSize: 12, marginTop: 2 },
  emptyCard: { padding: 24, alignItems: "center", textAlign: "center", gap: 8 },
  emptyTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  emptyBody: { color: "#64748B", fontSize: 12, textAlign: "center", lineHeight: 18 },
  deniedCard: { padding: 24, alignItems: "center", textAlign: "center", gap: 8 },
  deniedTitle: { color: "#DC2626", fontSize: 18, fontWeight: "900" },
  deniedBody: { color: "#64748B", fontSize: 13, textAlign: "center" },
});
