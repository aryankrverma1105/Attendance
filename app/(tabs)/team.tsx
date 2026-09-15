import { useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import {
  FieldButton,
  MetricCard,
  SectionHeading,
  StatusChip,
  Surface,
} from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatCurrency, formatDay, useFieldData } from "@/lib/field-data";
import { hasPermission } from "@/lib/field-access";
import type { ManagedUser } from "@/lib/field-types";

export default function ManagerTeamScreen() {
  const router = useRouter();
  const { data } = useFieldData();
  const [query, setQuery] = useState("");

  const actorRole = data.session?.role;
  const actorId = data.session?.id;
  const isManager = actorRole === "manager";
  const isAdmin = actorRole === "admin";
  const canAccessTeam = hasPermission(actorRole, "team.read.own");

  // Strictly filter for assigned team members if manager
  const teamMembers = useMemo(() => {
    if (isAdmin) return data.managedUsers.filter((u) => u.role === "employee");
    if (isManager) {
      return data.managedUsers.filter(
        (u) => u.managerId === actorId || (!u.managerId && u.role === "employee")
      );
    }
    return [];
  }, [data.managedUsers, isAdmin, isManager, actorId]);

  const visibleTeam = useMemo(() => {
    return teamMembers.filter((emp) =>
      `${emp.displayName} ${emp.identifier} ${emp.department ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    );
  }, [teamMembers, query]);

  const activeTodayCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return teamMembers.filter((emp) =>
      data.attendance.some(
        (a) => a.employeeId === emp.id && a.checkInAt.startsWith(today)
      )
    ).length;
  }, [teamMembers, data.attendance]);

  const handleCallWorker = (phone: string) => {
    const cleanPhone = phone.replace(/[^0-9+]/g, "");
    if (cleanPhone) {
      Linking.openURL(`tel:${cleanPhone}`).catch(() => {
        Alert.alert("Contact", `Call worker at ${cleanPhone}`);
      });
    }
  };

  if (!canAccessTeam) {
    return (
      <ScreenContainer containerClassName="bg-background" className="flex-1 p-5 justify-center">
        <Surface style={styles.restricted}>
          <MaterialIcons color="#D97706" name="lock" size={36} />
          <Text style={styles.restrictedTitle}>Access Restricted</Text>
          <Text style={styles.restrictedBody}>
            Team management is restricted to Field Managers and Administrators.
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
              <MaterialIcons color="#D97706" name="groups" size={14} />
              <Text style={styles.kicker}>FIELD OPERATIONS</Text>
            </View>
            <Text style={styles.title}>My Team</Text>
            <Text style={styles.subtitle}>
              {teamMembers.length} assigned field workers under your supervision
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/tasks" as any)}
            style={styles.dispatchBtn}
          >
            <MaterialIcons color="#92400E" name="add-task" size={20} />
          </Pressable>
        </View>

        {/* Team Summary Cards */}
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="people"
            label="Team Size"
            tone="navy"
            value={teamMembers.length.toString()}
          />
          <MetricCard
            icon="how-to-reg"
            label="Active Today"
            tone="success"
            value={activeTodayCount.toString()}
          />
          <MetricCard
            icon="pending-actions"
            label="Pending Tasks"
            tone="amber"
            value={data.tasks.filter((t) => t.status === "PENDING").length.toString()}
          />
        </View>

        {/* Search */}
        <TextInput
          onChangeText={setQuery}
          placeholder="Search team member by name, phone..."
          placeholderTextColor="#94A3B8"
          style={styles.search}
          value={query}
        />

        {/* Team Member Cards */}
        <SectionHeading
          action={
            <Pressable
              onPress={() => router.push("/tasks" as any)}
              style={styles.quickDispatchHeaderBtn}
            >
              <MaterialIcons color="#D97706" name="add" size={14} />
              <Text style={styles.quickDispatchHeaderText}>Assign Work</Text>
            </Pressable>
          }
          subtitle="Operational status & today's assignments"
          title="Team Roster"
        />

        {visibleTeam.length > 0 ? (
          <View style={styles.list}>
            {visibleTeam.map((emp) => {
              const activeTask = data.tasks.find(
                (t) => t.assignedToUserId === emp.id && t.status !== "COMPLETED"
              );
              const isCheckedIn = data.attendance.some(
                (a) =>
                  a.employeeId === emp.id &&
                  a.checkInAt.startsWith(new Date().toISOString().slice(0, 10)) &&
                  !a.checkOutAt
              );

              return (
                <Surface key={emp.id} style={styles.teamCard}>
                  <View style={styles.memberTop}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {emp.displayName.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{emp.displayName}</Text>
                      <Text style={styles.memberPhone}>{emp.identifier}</Text>
                      <Text style={styles.memberMeta}>
                        {emp.department || "Field Operations"} · Rate: {formatCurrency(emp.dailyWage)}/day
                      </Text>
                    </View>
                    <StatusChip
                      label={isCheckedIn ? "On Shift" : "Offline"}
                      tone={isCheckedIn ? "success" : "neutral"}
                    />
                  </View>

                  {/* Active Task / Work Status */}
                  <View style={styles.taskSection}>
                    <Text style={styles.taskSectionLabel}>ACTIVE WORK ORDER</Text>
                    {activeTask ? (
                      <View style={styles.activeTaskBox}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.activeTaskTitle}>{activeTask.title}</Text>
                          <Text style={styles.activeTaskMeta}>
                            {activeTask.customerName ? `Client: ${activeTask.customerName} · ` : ""}
                            Priority: {activeTask.priority}
                          </Text>
                        </View>
                        <StatusChip
                          label={activeTask.status === "IN_PROGRESS" ? "In Progress" : "Pending"}
                          tone={activeTask.status === "IN_PROGRESS" ? "solar" : "warning"}
                        />
                      </View>
                    ) : (
                      <Text style={styles.noTaskText}>No active task assigned for today</Text>
                    )}
                  </View>

                  <View style={styles.divider} />

                  {/* Operational Action Buttons */}
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => handleCallWorker(emp.identifier)}
                      style={styles.callBtn}
                    >
                      <MaterialIcons color="#059669" name="phone" size={15} />
                      <Text style={styles.callBtnText}>Call Worker</Text>
                    </Pressable>

                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/tasks",
                          params: { preselectWorkerId: emp.id },
                        })
                      }
                      style={styles.assignBtn}
                    >
                      <MaterialIcons color="#D97706" name="add-task" size={15} />
                      <Text style={styles.assignBtnText}>Assign Task</Text>
                    </Pressable>

                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/location-history",
                          params: { employeeId: emp.id },
                        })
                      }
                      style={styles.historyBtn}
                    >
                      <MaterialIcons color="#3B82F6" name="timeline" size={15} />
                      <Text style={styles.historyBtnText}>Route</Text>
                    </Pressable>
                  </View>
                </Surface>
              );
            })}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#F59E0B" name="group-off" size={32} />
            <Text style={styles.emptyTitle}>No team members found.</Text>
            <Text style={styles.emptyBody}>
              Employees assigned to your management group will appear here.
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
  dispatchBtn: {
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
  search: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    color: "#0F172A",
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 13,
    fontSize: 13,
  },
  quickDispatchHeaderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  quickDispatchHeaderText: { color: "#92400E", fontSize: 12, fontWeight: "800" },
  list: { gap: 12 },
  teamCard: { padding: 16, gap: 12 },
  memberTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#92400E", fontWeight: "900", fontSize: 18 },
  memberName: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  memberPhone: { color: "#64748B", fontSize: 12, marginTop: 1 },
  memberMeta: { color: "#64748B", fontSize: 11, marginTop: 2 },
  taskSection: {
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: 12,
    gap: 4,
  },
  taskSectionLabel: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  activeTaskBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  activeTaskTitle: { color: "#0F172A", fontSize: 13, fontWeight: "800" },
  activeTaskMeta: { color: "#64748B", fontSize: 11, marginTop: 1 },
  noTaskText: { color: "#94A3B8", fontSize: 12, fontStyle: "italic" },
  divider: { height: 1, backgroundColor: "#F1F5F9" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  callBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    paddingVertical: 8,
    borderRadius: 10,
  },
  callBtnText: { color: "#059669", fontSize: 11, fontWeight: "800" },
  assignBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    paddingVertical: 8,
    borderRadius: 10,
  },
  assignBtnText: { color: "#92400E", fontSize: 11, fontWeight: "800" },
  historyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  historyBtnText: { color: "#2563EB", fontSize: 11, fontWeight: "800" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 36 },
  emptyTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800" },
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
