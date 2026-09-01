import { useMemo } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, MetricCard, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import {
  calculateEarnings,
  calculateWorkedDays,
  calculateWorkingDaysInMonth,
  formatCurrency,
  formatDay,
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

  const managedUser = useMemo(() => {
    const rawDigits = (user?.identifier || "").replace(/[^0-9]/g, "");
    const last10 = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
    return data.managedUsers.find((u) => {
      const uDigits = (u.identifier || "").replace(/[^0-9]/g, "");
      return (
        (last10 && uDigits && (uDigits.endsWith(last10) || last10.endsWith(uDigits))) ||
        (user?.id && u.id === user.id) ||
        (u.identifier.toLowerCase() === (user?.identifier || "").toLowerCase())
      );
    });
  }, [data.managedUsers, user]);

  const userDisplayName = useMemo(() => {
    if (managedUser?.displayName && managedUser.displayName !== "Field employee" && managedUser.displayName !== "Field Employee") {
      return managedUser.displayName;
    }
    const isSessionNameValid = user?.displayName && user.displayName !== "Field employee" && user.displayName !== "Field Employee" && !user.displayName.startsWith("+") && !/^\d+$/.test(user.displayName);
    if (isSessionNameValid) {
      return user!.displayName;
    }
    if (user?.role === "admin" || user?.identifier?.includes("9835916278")) {
      return "Aryan Kumar Verma";
    }
    return "Technician";
  }, [managedUser, user]);

  // Employee attendance for today
  const todayAttendance = data.attendance.find(
    (record) => (!record.employeeId || record.employeeId === user?.id) && getDayKey(record.checkInAt) === today
  );
  const isShiftComplete = Boolean(todayAttendance && todayAttendance.checkOutAt);
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

  // Scoped team members for Manager
  const scopedTeam = useMemo(() => {
    if (isAdmin) return data.managedUsers.filter((u) => u.role === "employee");
    if (isManager) {
      return data.managedUsers.filter(
        (u) => u.managerId === user?.id || (!u.managerId && u.role === "employee")
      );
    }
    return [];
  }, [data.managedUsers, isAdmin, isManager, user?.id]);

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
  }, [data.tasks, data.managedUsers, isEmployee, isManager, user?.id, todayDateStr, today]);

  const activeFieldWorkers = useMemo(() => {
    return data.managedUsers.filter((u) => {
      if (u.role !== "employee") return false;
      return data.attendance.some(
        (a) => a.employeeId === u.id && a.checkInAt.startsWith(todayDateStr)
      );
    });
  }, [data.managedUsers, data.attendance, todayDateStr]);

  // Total organization estimated monthly payroll
  const totalOrgPayroll = useMemo(() => {
    return data.managedUsers.reduce((total, u) => {
      if (u.role !== "employee") return total;
      const userAtt = data.attendance.filter((rec) => rec.employeeId === u.id);
      const { workedDays: days } = calculateWorkedDays(userAtt, currentMonth, currentYear);
      return total + calculateEarnings(days, u.dailyWage || 0);
    }, 0);
  }, [data.managedUsers, data.attendance, currentMonth, currentYear]);

  // tRPC mutation for task status update
  const serverUpdateStatus = trpc.tasks.updateStatus.useMutation();

  const handleStatusTransition = async (taskId: string, nextStatus: TaskStatus) => {
    updateTaskStatus(taskId, nextStatus);
    await serverUpdateStatus.mutateAsync({
      taskId: taskId,
      status: nextStatus,
    }).catch((err: unknown) => console.warn("[Tasks] Status sync queued:", err));
  };

  const openNavigation = (lat?: string, lng?: string, address?: string) => {
    if (lat && lng) {
      const url = Platform.select({
        ios: `maps://app?daddr=${lat},${lng}`,
        android: `google.navigation:q=${lat},${lng}`,
        default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
      });
      Linking.openURL(url!).catch(() => {
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || `${lat},${lng}`)}`);
      });
    } else if (address) {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
    }
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ========================================================================= */}
        {/* ADMIN DASHBOARD: Control & Organization Oversight                         */}
        {/* ========================================================================= */}
        {isAdmin ? (
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <View style={styles.kickerRow}>
                  <MaterialIcons color="#D97706" name="admin-panel-settings" size={14} />
                  <Text style={styles.kicker}>ORGANIZATION CONTROL</Text>
                </View>
                <Text style={styles.title}>Admin Command Hub</Text>
                <Text style={styles.subtitle}>
                  Executive oversight of Sologix Energy workforce & operations
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/(tabs)/users" as any)}
                style={styles.actionBtn}
              >
                <MaterialIcons color="#92400E" name="person-add" size={20} />
              </Pressable>
            </View>

            {/* Key Organization KPI Cards */}
            <View style={styles.metricsGrid}>
              <MetricCard
                icon="people"
                label="Total Users"
                tone="success"
                value={data.managedUsers.length.toString()}
              />
              <MetricCard
                icon="how-to-reg"
                label="On Shift Today"
                tone="amber"
                value={activeFieldWorkers.length.toString()}
              />
              <MetricCard
                icon="payments"
                label="Est. Payroll"
                tone="navy"
                value={formatCurrency(totalOrgPayroll)}
              />
            </View>

            {/* Quick Action Matrix */}
            <SectionHeading title="Management Quick Actions" />
            <View style={styles.quickActionGrid}>
              <Pressable
                onPress={() => router.push("/(tabs)/users" as any)}
                style={styles.quickActionCard}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: "#FEF3C7" }]}>
                  <MaterialIcons color="#D97706" name="manage-accounts" size={22} />
                </View>
                <Text style={styles.quickActionTitle}>User Directory</Text>
                <Text style={styles.quickActionSubtitle}>Create & manage IDs</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/(tabs)/tasks" as any)}
                style={styles.quickActionCard}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: "#EFF6FF" }]}>
                  <MaterialIcons color="#2563EB" name="assignment" size={22} />
                </View>
                <Text style={styles.quickActionTitle}>Work Orders</Text>
                <Text style={styles.quickActionSubtitle}>View all {data.tasks.length} tasks</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/location-history" as any)}
                style={styles.quickActionCard}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: "#ECFDF5" }]}>
                  <MaterialIcons color="#059669" name="route" size={22} />
                </View>
                <Text style={styles.quickActionTitle}>Route Playback</Text>
                <Text style={styles.quickActionSubtitle}>Day-wise GPS history</Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/(tabs)/reports" as any)}
                style={styles.quickActionCard}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: "#FFF7ED" }]}>
                  <MaterialIcons color="#EA580C" name="insights" size={22} />
                </View>
                <Text style={styles.quickActionTitle}>Audit Reports</Text>
                <Text style={styles.quickActionSubtitle}>Workforce analytics</Text>
              </Pressable>
            </View>

            {/* Live Field Activity Stream */}
            <SectionHeading
              action={
                <Pressable
                  onPress={() => router.push("/location-history" as any)}
                  style={styles.headerLinkBtn}
                >
                  <Text style={styles.headerLinkText}>GPS History</Text>
                  <MaterialIcons color="#D97706" name="arrow-forward" size={13} />
                </Pressable>
              }
              subtitle="Workers actively recorded on shift today"
              title="Today's Field Activity"
            />

            {activeFieldWorkers.length > 0 ? (
              <View style={styles.activityList}>
                {activeFieldWorkers.map((emp) => (
                  <Surface key={emp.id} style={styles.activityCard}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{emp.displayName.slice(0, 1)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityName}>{emp.displayName}</Text>
                      <Text style={styles.activityMeta}>{emp.department || "Solar Operations"} · {emp.identifier}</Text>
                    </View>
                    <StatusChip label="Active" tone="success" />
                  </Surface>
                ))}
              </View>
            ) : (
              <Surface style={styles.emptyCard}>
                <MaterialIcons color="#D97706" name="person-off" size={28} />
                <Text style={styles.emptyCardTitle}>No field check-ins recorded yet today.</Text>
                <Text style={styles.emptyCardBody}>
                  Field employees who verify attendance will appear here in real-time.
                </Text>
              </Surface>
            )}
          </>
        ) : null}

        {/* ========================================================================= */}
        {/* MANAGER DASHBOARD: Team Operations & Dispatch                             */}
        {/* ========================================================================= */}
        {isManager ? (
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <View style={styles.kickerRow}>
                  <MaterialIcons color="#D97706" name="supervisor-account" size={14} />
                  <Text style={styles.kicker}>TEAM OPERATIONS</Text>
                </View>
                <Text style={styles.title}>Manager Workspace</Text>
                <Text style={styles.subtitle}>
                  Supervising {scopedTeam.length} field technicians and work orders
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/(tabs)/tasks" as any)}
                style={styles.actionBtn}
              >
                <MaterialIcons color="#92400E" name="add-task" size={20} />
              </Pressable>
            </View>

            {/* Team Metric Cards */}
            <View style={styles.metricsGrid}>
              <MetricCard
                icon="people"
                label="Team Members"
                tone="navy"
                value={scopedTeam.length.toString()}
              />
              <MetricCard
                icon="how-to-reg"
                label="Active Today"
                tone="success"
                value={activeFieldWorkers.filter((u) => u.managerId === user?.id).length.toString()}
              />
              <MetricCard
                icon="pending-actions"
                label="Tasks Today"
                tone="amber"
                value={todaysTasks.length.toString()}
              />
            </View>

            {/* Dispatch Banner */}
            <Surface style={styles.dispatchBanner}>
              <View style={styles.dispatchIconWrap}>
                <MaterialIcons color="#D97706" name="add-task" size={24} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dispatchTitle}>Assign Field Task</Text>
                <Text style={styles.dispatchSubtitle}>
                  Dispatch a work order with customer site location and priority.
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/(tabs)/tasks" as any)}
                style={styles.dispatchBtn}
              >
                <Text style={styles.dispatchBtnText}>Assign</Text>
                <MaterialIcons color="#0F172A" name="arrow-forward" size={14} />
              </Pressable>
            </Surface>

            {/* Today's Team Work Orders */}
            <SectionHeading
              action={
                <Pressable
                  onPress={() => router.push("/(tabs)/tasks" as any)}
                  style={styles.headerLinkBtn}
                >
                  <Text style={styles.headerLinkText}>All Orders</Text>
                  <MaterialIcons color="#D97706" name="arrow-forward" size={13} />
                </Pressable>
              }
              subtitle="Today's dispatched work orders"
              title="Today's Work Orders"
            />

            {todaysTasks.length > 0 ? (
              <View style={styles.activityList}>
                {todaysTasks.map((task) => (
                  <Surface key={task.id} style={styles.taskSummaryCard}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.taskSummaryTitle}>{task.title}</Text>
                      <Text style={styles.taskSummaryMeta}>
                        Worker: {task.assignedToName || "Assigned"} {task.customerName ? `· Client: ${task.customerName}` : ""}
                      </Text>
                    </View>
                    <StatusChip
                      label={task.status === "COMPLETED" ? "Done" : task.status === "IN_PROGRESS" ? "In Progress" : "Pending"}
                      tone={task.status === "COMPLETED" ? "success" : task.status === "IN_PROGRESS" ? "solar" : "warning"}
                    />
                  </Surface>
                ))}
              </View>
            ) : (
              <Surface style={styles.emptyCard}>
                <MaterialIcons color="#D97706" name="assignment-late" size={28} />
                <Text style={styles.emptyCardTitle}>No work orders scheduled for today.</Text>
                <Text style={styles.emptyCardBody}>
                  Tap 'Assign' above to dispatch maintenance or inspection tasks to your team.
                </Text>
              </Surface>
            )}
          </>
        ) : null}

        {/* ========================================================================= */}
        {/* EMPLOYEE DASHBOARD: Action & Field Execution                              */}
        {/* ========================================================================= */}
        {isEmployee ? (
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <View style={styles.kickerRow}>
                  <MaterialIcons color="#D97706" name="bolt" size={14} />
                  <Text style={styles.kicker}>SOLAR FIELD SHIFT</Text>
                </View>
                <Text style={styles.title}>
                  Hello, {userDisplayName}
                </Text>
                <Text style={styles.subtitle}>
                  {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                </Text>
              </View>
            </View>

            {/* Solar Attendance Card */}
            <Surface style={styles.checkinCard}>
              <View style={styles.checkinHeader}>
                <View style={[
                  styles.checkinIconWrap,
                  isShiftComplete && { backgroundColor: "#DCFCE7" },
                ]}>
                  <MaterialIcons
                    color={isShiftComplete ? "#16A34A" : needsCheckout ? "#10B981" : "#D97706"}
                    name={isShiftComplete ? "task-alt" : needsCheckout ? "how-to-reg" : "access-time"}
                    size={24}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkinTitle}>
                    {isShiftComplete
                      ? "Shift Completed for Today"
                      : needsCheckout
                      ? "Currently On Shift"
                      : "Ready to Start Shift"}
                  </Text>
                  <Text style={styles.checkinSubtitle}>
                    {isShiftComplete
                      ? `Shift logged: ${formatTime(todayAttendance?.checkInAt)} → ${formatTime(todayAttendance?.checkOutAt)} · Verified`
                      : needsCheckout
                      ? `Checked in at ${formatTime(todayAttendance?.checkInAt)} · GPS Verified`
                      : "Capture your morning GPS location to mark attendance."}
                  </Text>
                </View>
              </View>

              {isShiftComplete ? (
                <FieldButton
                  icon="history"
                  label="View Today's Shift Evidence"
                  onPress={() => router.push("/history")}
                  variant="secondary"
                />
              ) : (
                <FieldButton
                  icon={needsCheckout ? "logout" : "login"}
                  label={needsCheckout ? "Check out for today" : "Check in with GPS"}
                  onPress={() =>
                    router.push({
                      pathname: "/attendance",
                      params: { action: needsCheckout ? "check-out" : "check-in" },
                    })
                  }
                  variant={needsCheckout ? "secondary" : "primary"}
                />
              )}
            </Surface>

            {/* 4 Personal Metric Cards */}
            <View style={styles.metricsGrid}>
              <MetricCard
                icon="event-available"
                label="Worked Days"
                tone="success"
                value={`${workedDays} / ${workingDaysInMonth}`}
              />
              <MetricCard
                icon="payments"
                label="Month Earnings"
                tone="amber"
                value={formatCurrency(calculatedEarnings)}
              />
              <MetricCard
                icon="assignment"
                label="Today's Tasks"
                tone="navy"
                value={todaysTasks.length.toString()}
              />
            </View>

            {/* Today's Tasks */}
            <SectionHeading
              action={
                <Pressable
                  onPress={() => router.push("/(tabs)/tasks" as any)}
                  style={styles.headerLinkBtn}
                >
                  <Text style={styles.headerLinkText}>All Tasks</Text>
                  <MaterialIcons color="#D97706" name="arrow-forward" size={13} />
                </Pressable>
              }
              subtitle="Your scheduled field work orders"
              title="Today's Tasks"
            />

            {todaysTasks.length > 0 ? (
              <View style={styles.activityList}>
                {todaysTasks.map((t) => (
                  <Surface key={t.id} style={styles.employeeTaskCard}>
                    <View style={styles.employeeTaskTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.employeeTaskTitle}>{t.title}</Text>
                        {t.customerName ? (
                          <Text style={styles.employeeTaskClient}>Client: {t.customerName}</Text>
                        ) : null}
                      </View>
                      <StatusChip
                        label={t.priority}
                        tone={t.priority === "URGENT" || t.priority === "HIGH" ? "danger" : "solar"}
                      />
                    </View>

                    {t.locationAddress ? (
                      <View style={styles.locationRow}>
                        <MaterialIcons color="#64748B" name="place" size={14} />
                        <Text numberOfLines={1} style={styles.locationText}>{t.locationAddress}</Text>
                      </View>
                    ) : null}

                    <View style={styles.taskActionRow}>
                      {t.locationAddress || t.locationLat ? (
                        <Pressable
                          onPress={() => openNavigation(t.locationLat, t.locationLng, t.locationAddress)}
                          style={styles.navBtn}
                        >
                          <MaterialIcons color="#2563EB" name="directions" size={14} />
                          <Text style={styles.navBtnText}>Directions</Text>
                        </Pressable>
                      ) : null}

                      {t.status === "PENDING" ? (
                        <Pressable
                          onPress={() => handleStatusTransition(t.id, "IN_PROGRESS")}
                          style={styles.startTaskBtn}
                        >
                          <MaterialIcons color="#0F172A" name="play-arrow" size={14} />
                          <Text style={styles.startTaskBtnText}>Start</Text>
                        </Pressable>
                      ) : null}

                      {t.status === "IN_PROGRESS" ? (
                        <Pressable
                          onPress={() => handleStatusTransition(t.id, "COMPLETED")}
                          style={styles.completeTaskBtn}
                        >
                          <MaterialIcons color="#FFFFFF" name="check" size={14} />
                          <Text style={styles.completeTaskBtnText}>Complete</Text>
                        </Pressable>
                      ) : null}

                      {t.status === "COMPLETED" ? (
                        <StatusChip label="Completed" tone="success" />
                      ) : null}
                    </View>
                  </Surface>
                ))}
              </View>
            ) : (
              <Surface style={styles.emptyCard}>
                <MaterialIcons color="#10B981" name="task-alt" size={28} />
                <Text style={styles.emptyCardTitle}>No work orders scheduled for today.</Text>
                <Text style={styles.emptyCardBody}>
                  You are all set! New tasks dispatched by your manager will appear here.
                </Text>
              </Surface>
            )}
          </>
        ) : null}
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
  actionBtn: {
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
  quickActionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickActionCard: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  quickActionTitle: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  quickActionSubtitle: { color: "#64748B", fontSize: 11 },
  headerLinkBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  headerLinkText: { color: "#D97706", fontSize: 12, fontWeight: "800" },
  activityList: { gap: 10 },
  activityCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#92400E", fontWeight: "900", fontSize: 16 },
  activityName: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  activityMeta: { color: "#64748B", fontSize: 11, marginTop: 1 },
  emptyCard: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyCardTitle: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  emptyCardBody: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 270,
  },
  dispatchBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFDF7",
  },
  dispatchIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  dispatchTitle: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  dispatchSubtitle: { color: "#64748B", fontSize: 12, lineHeight: 16, marginTop: 2 },
  dispatchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  dispatchBtnText: { color: "#0F172A", fontSize: 11, fontWeight: "800" },
  taskSummaryCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  taskSummaryTitle: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  taskSummaryMeta: { color: "#64748B", fontSize: 11, marginTop: 2 },
  checkinCard: {
    padding: 16,
    gap: 14,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFDF7",
  },
  checkinHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  checkinIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  checkinTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  checkinSubtitle: { color: "#64748B", fontSize: 12, lineHeight: 16, marginTop: 2 },
  employeeTaskCard: { padding: 14, gap: 10 },
  employeeTaskTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  employeeTaskTitle: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  employeeTaskClient: { color: "#D97706", fontSize: 11, fontWeight: "700", marginTop: 2 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  locationText: { color: "#64748B", fontSize: 11, flex: 1 },
  taskActionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  navBtnText: { color: "#2563EB", fontSize: 11, fontWeight: "800" },
  startTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  startTaskBtnText: { color: "#0F172A", fontSize: 11, fontWeight: "800" },
  completeTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#059669",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  completeTaskBtnText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
});
