import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, MetricCard, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import {
  calculateEarnings,
  calculateWorkedDays,
  calculateWorkingDaysInMonth,
  formatCurrency,
  formatTime,
  getDayKey,
  routeDistanceKm,
  useFieldData,
} from "@/lib/field-data";
import { canAssignTasks, canUpdateTaskStatus } from "@/lib/field-access";
import { trpc } from "@/lib/trpc";
import type { TaskStatus } from "@/lib/field-types";

export default function HomeScreen() {
  const router = useRouter();
  const { data, updateTaskStatus } = useFieldData();
  const today = getDayKey(new Date());
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const user = data.session;
  const isEmployee = !user?.role || user?.role === "employee";
  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "manager";
  const isAdminOrManager = isAdmin || isManager;

  // Employee attendance for today
  const todayAttendance = data.attendance.find((record) => getDayKey(record.checkInAt) === today);
  const needsCheckout = Boolean(todayAttendance && !todayAttendance.checkOutAt);

  // Employee-specific worked days and earnings calculation
  const employeeAttendance = useMemo(
    () =>
      data.attendance.filter(
        (record) => !record.employeeId || record.employeeId === user?.id
      ),
    [data.attendance, user?.id]
  );

  const { workedDays } = useMemo(
    () => calculateWorkedDays(employeeAttendance, currentMonth, currentYear),
    [employeeAttendance, currentMonth, currentYear]
  );

  const workingDaysInMonth = useMemo(
    () => calculateWorkingDaysInMonth(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  // Daily wage applies exclusively to employees; admin & manager are salaried
  const userDailyWage = isEmployee ? (user?.dailyWage ?? 0) : 0;
  const calculatedEarnings = useMemo(
    () => (isEmployee ? calculateEarnings(workedDays, userDailyWage) : 0),
    [isEmployee, workedDays, userDailyWage]
  );

  // Visits
  const todaysVisits = useMemo(
    () => data.visits.filter((visit) => getDayKey(visit.scheduledFor) === today),
    [data.visits, today]
  );

  // Tasks: Today's Tasks
  const todaysTasks = useMemo(() => {
    return data.tasks.filter((t) => {
      const isToday = t.scheduledDate === todayDateStr || t.scheduledDate === today;
      if (isEmployee) {
        return isToday && t.assignedToUserId === user?.id;
      } else if (isManager) {
        const target = data.managedUsers.find((u) => u.id === t.assignedToUserId);
        return isToday && (target?.managerId === user?.id || t.assignedByUserId === user?.id);
      }
      return isToday;
    });
  }, [data.tasks, data.managedUsers, user, isEmployee, isManager, todayDateStr, today]);

  // Management stats
  const teamMembers = useMemo(() => {
    if (isAdmin) return data.managedUsers;
    if (isManager) return data.managedUsers.filter((u) => u.managerId === user?.id);
    return [];
  }, [data.managedUsers, isAdmin, isManager, user]);

  const presentCount = useMemo(() => {
    const presentIds = new Set(
      data.attendance
        .filter((a) => getDayKey(a.checkInAt) === today)
        .map((a) => a.employeeId)
        .filter(Boolean)
    );
    return teamMembers.filter((m) => presentIds.has(m.id)).length;
  }, [data.attendance, teamMembers, today]);

  const activeTrackingCount = useMemo(() => {
    return data.routePoints.filter((pt) => pt.capturedAt?.startsWith(todayDateStr)).length > 0 ? 1 : 0;
  }, [data.routePoints, todayDateStr]);

  const pendingItems = data.offlineQueue.length;

  const handleTaskStatusChange = (taskId: string, currentStatus: TaskStatus) => {
    const nextStatus: TaskStatus =
      currentStatus === "PENDING"
        ? "IN_PROGRESS"
        : currentStatus === "IN_PROGRESS"
        ? "COMPLETED"
        : "COMPLETED";
    updateTaskStatus(taskId, nextStatus);
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Sunlight High-Contrast Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.kickerRow}>
              <MaterialIcons color="#D97706" name="solar-power" size={15} />
              <Text style={styles.kicker}>SOLOGIX FIELD FORCE</Text>
            </View>
            <Text style={styles.greeting}>
              Good {now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"},{" "}
              {data.session?.displayName?.split(" ")[0] ?? "Aryan"} 👋
            </Text>
            <Text style={styles.date}>
              {new Intl.DateTimeFormat(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              }).format(new Date())}
            </Text>
          </View>
          <Pressable onPress={() => router.push("/(tabs)/profile")} style={styles.avatar}>
            <Text style={styles.avatarText}>
              {data.session?.displayName?.slice(0, 1).toUpperCase() ?? "A"}
            </Text>
          </Pressable>
        </View>

        {/* =========================================================================
            ADMIN / MANAGER VIEW: Salaried Management Command Hub
            ========================================================================= */}
        {isAdminOrManager ? (
          <>
            {/* Management Hub Surface */}
            <Surface style={styles.managementHubCard}>
              <View style={styles.managementHeader}>
                <View style={styles.managementIconWrap}>
                  <MaterialIcons color="#D97706" name={isAdmin ? "admin-panel-settings" : "supervisor-account"} size={24} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.managementTitle}>
                    {isAdmin ? "Enterprise Administrator Command" : "Manager Field Command"}
                  </Text>
                  <Text style={styles.managementSubtitle}>
                    Salaried Management · {teamMembers.length} active team members
                  </Text>
                </View>
                <Pressable
                  onPress={() => router.push(isAdmin ? "/admin-dashboard" : "/tasks")}
                  style={styles.actionRoundBtn}
                >
                  <MaterialIcons color="#0F172A" name="settings" size={18} />
                </Pressable>
              </View>

              <View style={styles.mgmtQuickBar}>
                <FieldButton
                  icon="add-task"
                  label="Assign Task"
                  onPress={() => router.push("/tasks")}
                  style={{ flex: 1 }}
                  variant="primary"
                />
                <FieldButton
                  icon="route"
                  label="Day Routes"
                  onPress={() => router.push("/location-history")}
                  style={{ flex: 1 }}
                  variant="secondary"
                />
                {isAdmin ? (
                  <FieldButton
                    icon="person-add"
                    label="Add User"
                    onPress={() => router.push("/admin-dashboard")}
                    style={{ flex: 1 }}
                    variant="amber"
                  />
                ) : null}
              </View>
            </Surface>

            {/* Management KPI Grid */}
            <SectionHeading title="Workforce Overview" />
            <View style={styles.metricGrid}>
              <MetricCard
                icon="groups"
                label="Team Size"
                subtitle="Active Members"
                tone="navy"
                value={`${teamMembers.length} Members`}
              />
              <MetricCard
                icon="how-to-reg"
                label="Present Today"
                subtitle={`${teamMembers.length - presentCount} Absent`}
                tone="success"
                value={`${presentCount} Present`}
              />
              <MetricCard
                icon="assignment"
                label="Today's Tasks"
                onPress={() => router.push("/tasks")}
                subtitle={`${todaysTasks.filter((t) => t.status === "COMPLETED").length} Completed`}
                tone="amber"
                value={`${todaysTasks.length} Orders`}
              />
              <MetricCard
                icon="gps-fixed"
                label="Tracking Now"
                onPress={() => router.push("/location-history")}
                subtitle="Live Field GPS"
                tone="default"
                value={`${teamMembers.length > 0 ? presentCount : 0} Live`}
              />
            </View>
          </>
        ) : (
          /* =========================================================================
             EMPLOYEE VIEW: 4 KPIs (Strictly NO Daily Wage card on Home) & Check-in Hero
             ========================================================================= */
          <>
            {/* Today's Attendance Hero Banner — Sunlight High Contrast */}
            <Surface style={styles.employeeHeroSurface}>
              <View style={styles.heroHeader}>
                <StatusChip
                  label={
                    needsCheckout
                      ? "ON FIELD DUTY"
                      : todayAttendance
                      ? "ATTENDANCE COMPLETE"
                      : "NOT CHECKED IN"
                  }
                  tone={needsCheckout ? "success" : todayAttendance ? "neutral" : "warning"}
                />
                <View style={styles.gpsBadge}>
                  <MaterialIcons
                    color={data.trackingActive ? "#059669" : "#D97706"}
                    name={data.trackingActive ? "gps-fixed" : "gps-not-fixed"}
                    size={14}
                  />
                  <Text style={styles.gpsText}>
                    {data.trackingActive ? "GPS Active" : "GPS Ready"}
                  </Text>
                </View>
              </View>

              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>
                  {needsCheckout
                    ? "You’re actively checked in on field duty."
                    : todayAttendance
                    ? "Today's attendance shift captured."
                    : "Ready to start today's field work?"}
                </Text>
                <Text style={styles.heroBody}>
                  {needsCheckout
                    ? `Checked in at ${formatTime(todayAttendance?.checkInAt)}. Record a verified check-out when your shift ends.`
                    : todayAttendance
                    ? `Shift recorded (${formatTime(todayAttendance.checkInAt)} → ${formatTime(todayAttendance.checkOutAt)}).`
                    : "Capture photo and verified GPS coordinates to record your daily attendance."}
                </Text>
              </View>

              <FieldButton
                icon={needsCheckout ? "logout" : "verified-user"}
                label={needsCheckout ? "Check out securely" : "Check in securely"}
                onPress={() =>
                  router.push({
                    pathname: "/attendance",
                    params: { action: needsCheckout ? "check-out" : "check-in" },
                  })
                }
                style={styles.heroButton}
                variant="primary"
              />
            </Surface>

            {/* Four Primary KPI Cards (Strictly NO Daily Wage card) */}
            <SectionHeading title="Work & Payout Summary" />
            <View style={styles.metricGrid}>
              {/* KPI 1 — WORKED DAYS */}
              <MetricCard
                icon="wb-sunny"
                label="Worked Days"
                subtitle="This Month"
                tone="amber"
                trend={`${workedDays} days verified`}
                value={`${workedDays} Days`}
              />

              {/* KPI 2 — EARNINGS (Clickable to My Earnings drill-down) */}
              <MetricCard
                icon="payments"
                label="Earnings"
                onPress={() => router.push("/earnings" as any)}
                subtitle="This Month"
                tone="success"
                trend="Tap for breakdown"
                value={formatCurrency(calculatedEarnings)}
              />

              {/* KPI 3 — ATTENDANCE */}
              <MetricCard
                icon="how-to-reg"
                label="Attendance"
                subtitle="Working Days"
                tone="navy"
                value={`${workedDays} / ${workingDaysInMonth}`}
              />

              {/* KPI 4 — VISITS */}
              <MetricCard
                icon="storefront"
                label="Visits"
                onPress={() => router.push("/(tabs)/visits")}
                subtitle="Today's Schedule"
                value={String(todaysVisits.length)}
              />
            </View>
          </>
        )}

        {/* =========================================================================
            TODAY'S TASKS SECTION (Field Work Orders)
            ========================================================================= */}
        <SectionHeading
          action={
            <Pressable onPress={() => router.push("/tasks")} style={styles.textAction}>
              <Text style={styles.textActionLabel}>View all tasks ({data.tasks.length})</Text>
              <MaterialIcons color="#D97706" name="arrow-forward" size={15} />
            </Pressable>
          }
          subtitle={`${todaysTasks.length} work orders scheduled for today`}
          title="Today’s Tasks"
        />

        {todaysTasks.length === 0 ? (
          <Surface style={styles.emptyTaskSurface}>
            <View style={styles.emptyIconWrap}>
              <MaterialIcons color="#D97706" name="assignment-turned-in" size={24} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyTaskTitle}>No pending tasks for today</Text>
              <Text style={styles.emptyTaskSub}>
                {isAdminOrManager
                  ? "Tap 'Assign Task' above to dispatch a work order to your field engineers."
                  : "Your daily task itinerary is clear. Check back later or plan a customer visit."}
              </Text>
            </View>
            {isAdminOrManager ? (
              <Pressable onPress={() => router.push("/tasks")} style={styles.actionRoundBtn}>
                <MaterialIcons color="#0F172A" name="add" size={18} />
              </Pressable>
            ) : null}
          </Surface>
        ) : (
          todaysTasks.slice(0, 3).map((task) => {
            const canUpdate = canUpdateTaskStatus({
              actorRole: user?.role,
              actorId: user?.id,
              assignedToUserId: task.assignedToUserId,
            });

            return (
              <Surface key={task.id} style={styles.taskCard}>
                <View style={styles.taskHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgeRow}>
                      <StatusChip
                        label={task.priority}
                        tone={
                          task.priority === "URGENT" || task.priority === "HIGH"
                            ? "danger"
                            : task.priority === "MEDIUM"
                            ? "solar"
                            : "neutral"
                        }
                      />
                      <StatusChip
                        label={task.status.replace("_", " ")}
                        tone={
                          task.status === "COMPLETED"
                            ? "success"
                            : task.status === "IN_PROGRESS"
                            ? "solar"
                            : "neutral"
                        }
                      />
                    </View>
                    <Text style={styles.taskCardTitle}>{task.title}</Text>
                  </View>
                </View>

                {task.customerName ? (
                  <View style={styles.taskMetaRow}>
                    <MaterialIcons color="#D97706" name="storefront" size={14} />
                    <Text style={styles.taskMetaText}>{task.customerName}</Text>
                  </View>
                ) : null}

                {task.locationAddress ? (
                  <View style={styles.taskMetaRow}>
                    <MaterialIcons color="#64748B" name="place" size={14} />
                    <Text style={styles.taskMetaText}>{task.locationAddress}</Text>
                  </View>
                ) : null}

                {isEmployee && canUpdate && task.status !== "COMPLETED" ? (
                  <View style={styles.taskActions}>
                    {task.status === "PENDING" ? (
                      <FieldButton
                        icon="play-arrow"
                        label="Start Task"
                        onPress={() => handleTaskStatusChange(task.id, "PENDING")}
                        style={{ flex: 1 }}
                        variant="primary"
                      />
                    ) : (
                      <FieldButton
                        icon="check-circle"
                        label="Complete Task"
                        onPress={() => handleTaskStatusChange(task.id, "IN_PROGRESS")}
                        style={{ flex: 1 }}
                        variant="primary"
                      />
                    )}
                  </View>
                ) : null}
              </Surface>
            );
          })
        )}

        {/* Quick Actions Bar */}
        <SectionHeading title="Quick actions" />
        <View style={styles.quickActions}>
          <Pressable
            onPress={() => router.push(isAdminOrManager ? "/tasks" : "/visit-plan")}
            style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
          >
            <View style={[styles.quickIconWrap, { backgroundColor: "#FEF3C7" }]}>
              <MaterialIcons color="#D97706" name={isAdminOrManager ? "assignment" : "add-location-alt"} size={22} />
            </View>
            <Text style={styles.quickLabel}>{isAdminOrManager ? "Tasks" : "Plan visit"}</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/location-history")}
            style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
          >
            <View style={[styles.quickIconWrap, { backgroundColor: "#EFF6FF" }]}>
              <MaterialIcons color="#2563EB" name="route" size={22} />
            </View>
            <Text style={styles.quickLabel}>GPS Routes</Text>
          </Pressable>

          {isEmployee ? (
            <Pressable
              onPress={() => router.push("/earnings" as any)}
              style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
            >
              <View style={[styles.quickIconWrap, { backgroundColor: "#ECFDF5" }]}>
                <MaterialIcons color="#059669" name="payments" size={22} />
              </View>
              <Text style={styles.quickLabel}>My Earnings</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push("/admin-dashboard")}
              style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
            >
              <View style={[styles.quickIconWrap, { backgroundColor: "#ECFDF5" }]}>
                <MaterialIcons color="#059669" name="people" size={22} />
              </View>
              <Text style={styles.quickLabel}>Team</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => router.push("/offline-queue")}
            style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
          >
            <View style={[styles.quickIconWrap, { backgroundColor: "#F1F5F9" }]}>
              <MaterialIcons color="#334155" name="sync" size={22} />
            </View>
            <Text style={styles.quickLabel}>Queue ({pendingItems})</Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 36, gap: 18 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  kicker: { color: "#D97706", fontWeight: "900", fontSize: 10, letterSpacing: 1.3 },
  greeting: { color: "#0F172A", fontWeight: "900", fontSize: 24, letterSpacing: -0.6 },
  date: { color: "#475569", marginTop: 3, fontSize: 13, fontWeight: "600" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#92400E", fontWeight: "900", fontSize: 18 },

  // Management Hub
  managementHubCard: {
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    gap: 14,
  },
  managementHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  managementIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    alignItems: "center",
    justifyContent: "center",
  },
  managementTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  managementSubtitle: { color: "#475569", fontSize: 12, marginTop: 2, fontWeight: "600" },
  actionRoundBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  mgmtQuickBar: { flexDirection: "row", gap: 8 },

  // Employee Hero Surface — Sunlight Optimized Light Card
  employeeHeroSurface: {
    padding: 18,
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderWidth: 1.5,
    borderRadius: 22,
    gap: 12,
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  gpsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  gpsText: { color: "#0F172A", fontSize: 11, fontWeight: "800" },
  heroCopy: { gap: 4 },
  heroTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  heroBody: { color: "#334155", fontSize: 13, lineHeight: 18 },
  heroButton: { marginTop: 4 },

  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  textAction: { flexDirection: "row", alignItems: "center", gap: 4 },
  textActionLabel: { color: "#D97706", fontSize: 12, fontWeight: "800" },

  // Tasks Section
  emptyTaskSurface: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
  },
  emptyIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTaskTitle: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  emptyTaskSub: { color: "#64748B", fontSize: 12, lineHeight: 16, marginTop: 2 },
  taskCard: {
    padding: 14,
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
  },
  taskHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 4 },
  taskCardTitle: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  taskMetaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  taskMetaText: { color: "#334155", fontSize: 12, fontWeight: "600" },
  taskActions: { marginTop: 6, flexDirection: "row", gap: 8 },

  quickActions: { flexDirection: "row", gap: 10 },
  quickAction: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    minHeight: 88,
    borderRadius: 18,
    padding: 10,
    justifyContent: "space-between",
    alignItems: "center",
  },
  quickIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  quickLabel: {
    color: "#0F172A",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.88 },
});
