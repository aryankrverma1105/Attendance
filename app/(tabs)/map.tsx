import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { RouteMap } from "@/components/route-map";
import { FieldButton, MetricCard, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useFieldData } from "@/lib/field-data";
import { hasPermission } from "@/lib/field-access";

export default function OperationalTeamMapScreen() {
  const router = useRouter();
  const { data } = useFieldData();
  const [filter, setFilter] = useState<"all" | "workers" | "tasks" | "customers">("all");

  const actorRole = data.session?.role;
  const actorId = data.session?.id;
  const isManager = actorRole === "manager";
  const isAdmin = actorRole === "admin";
  const canViewMap = hasPermission(actorRole, "map.read.ownTeam");

  // Scoped team members
  const scopedTeam = useMemo(() => {
    if (isAdmin) return data.managedUsers.filter((u) => u.role === "employee");
    if (isManager) {
      return data.managedUsers.filter(
        (u) => u.managerId === actorId || (!u.managerId && u.role === "employee")
      );
    }
    return [];
  }, [data.managedUsers, isAdmin, isManager, actorId]);

  // Scoped team tasks
  const scopedTasks = useMemo(() => {
    const workerIds = new Set(scopedTeam.map((u) => u.id));
    return data.tasks.filter((t) => workerIds.has(t.assignedToUserId));
  }, [data.tasks, scopedTeam]);

  // Generate map points from customers and route points
  const mapPoints = useMemo(() => {
    return data.routePoints;
  }, [data.routePoints]);

  if (!canViewMap) {
    return (
      <ScreenContainer containerClassName="bg-background" className="flex-1 p-5 justify-center">
        <Surface style={styles.restricted}>
          <MaterialIcons color="#D97706" name="lock" size={36} />
          <Text style={styles.restrictedTitle}>Access Restricted</Text>
          <Text style={styles.restrictedBody}>
            The Operational Team Map is available for Field Managers and Administrators.
          </Text>
        </Surface>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.kickerRow}>
              <MaterialIcons color="#D97706" name="map" size={14} />
              <Text style={styles.kicker}>OPERATIONAL AWARENESS</Text>
            </View>
            <Text style={styles.title}>Team Field Map</Text>
            <Text style={styles.subtitle}>
              Live geographic overview of team field assignments and customer sites
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/location-history" as any)}
            style={styles.historyBtn}
          >
            <MaterialIcons color="#92400E" name="timeline" size={20} />
          </Pressable>
        </View>

        {/* Operational Metrics */}
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="people"
            label="Field Workers"
            tone="success"
            value={scopedTeam.length.toString()}
          />
          <MetricCard
            icon="assignment"
            label="Active Orders"
            tone="amber"
            value={scopedTasks.length.toString()}
          />
          <MetricCard
            icon="business"
            label="Client Sites"
            tone="navy"
            value={data.customers.length.toString()}
          />
        </View>

        {/* Filter Pills */}
        <View style={styles.filterRow}>
          {(["all", "workers", "tasks", "customers"] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === "all"
                  ? "All Markers"
                  : f === "workers"
                  ? "Team Workers"
                  : f === "tasks"
                  ? "Active Tasks"
                  : "Customer Sites"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Map Container */}
        <Surface style={styles.mapCard}>
          <RouteMap points={mapPoints} />
        </Surface>

        {/* Active Locations Roster */}
        <SectionHeading
          action={
            <Pressable
              onPress={() => router.push("/location-history" as any)}
              style={styles.playbackBtn}
            >
              <MaterialIcons color="#D97706" name="play-circle-outline" size={15} />
              <Text style={styles.playbackBtnText}>Route Playback</Text>
            </Pressable>
          }
          subtitle="Real-time waypoint trail and active task destinations"
          title="Active Operational Sites"
        />

        {scopedTasks.length > 0 ? (
          <View style={styles.taskList}>
            {scopedTasks.map((t) => {
              const worker = data.managedUsers.find((u) => u.id === t.assignedToUserId);
              return (
                <Surface key={t.id} style={styles.taskItem}>
                  <View style={styles.taskIcon}>
                    <MaterialIcons color="#D97706" name="place" size={20} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.taskTitle}>{t.title}</Text>
                    <Text style={styles.taskMeta}>
                      Worker: {worker?.displayName ?? "Assigned"} · {t.customerName ?? "Solar Site"}
                    </Text>
                    {t.locationAddress ? (
                      <Text style={styles.taskAddress}>{t.locationAddress}</Text>
                    ) : null}
                  </View>
                  <StatusChip
                    label={t.priority}
                    tone={t.priority === "URGENT" || t.priority === "HIGH" ? "danger" : "solar"}
                  />
                </Surface>
              );
            })}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#F59E0B" name="location-off" size={28} />
            <Text style={styles.emptyTitle}>No active field task markers today.</Text>
            <Text style={styles.emptyBody}>
              Assign tasks with customer site locations to view live markers on this operational map.
            </Text>
          </Surface>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 },
  kicker: { color: "#D97706", fontSize: 10, letterSpacing: 1.2, fontWeight: "900" },
  title: { color: "#0F172A", fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: "#64748B", fontSize: 12, marginTop: 2 },
  historyBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    alignItems: "center",
    justifyContent: "center",
  },
  metricsGrid: { flexDirection: "row", gap: 10 },
  filterRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  filterChip: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  filterChipActive: { borderColor: "#F59E0B", backgroundColor: "#FEF3C7" },
  filterText: { color: "#64748B", fontSize: 11, fontWeight: "700" },
  filterTextActive: { color: "#92400E", fontWeight: "900" },
  mapCard: { padding: 0, overflow: "hidden", borderRadius: 20 },
  playbackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  playbackBtnText: { color: "#92400E", fontSize: 12, fontWeight: "800" },
  taskList: { gap: 10 },
  taskItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  taskIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  taskTitle: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  taskMeta: { color: "#64748B", fontSize: 11 },
  taskAddress: { color: "#94A3B8", fontSize: 11, marginTop: 1 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyTitle: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  emptyBody: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 270,
  },
  restricted: { alignItems: "center", gap: 12, paddingVertical: 36, paddingHorizontal: 20 },
  restrictedTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  restrictedBody: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 13,
    lineHeight: 19,
  },
});
