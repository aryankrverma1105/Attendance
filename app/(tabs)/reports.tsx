import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, MetricCard, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { calculateEarnings, calculateWorkedDays, formatCurrency, formatDay, useFieldData } from "@/lib/field-data";
import { hasPermission } from "@/lib/field-access";

export default function ReportsScreen() {
  const router = useRouter();
  const { data } = useFieldData();

  const actorRole = data.session?.role;
  const actorId = data.session?.id;
  const isAdmin = actorRole === "admin";
  const isManager = actorRole === "manager";
  const isEmployee = actorRole === "employee";

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Scoped team members for Manager
  const scopedTeam = useMemo(() => {
    if (isAdmin) return data.managedUsers.filter((u) => u.role === "employee");
    if (isManager) {
      return data.managedUsers.filter(
        (u) => u.managerId === actorId || (!u.managerId && u.role === "employee")
      );
    }
    return [];
  }, [data.managedUsers, isAdmin, isManager, actorId]);

  // Scoped tasks
  const scopedTasks = useMemo(() => {
    if (isAdmin) return data.tasks;
    if (isManager) {
      const workerIds = new Set(scopedTeam.map((u) => u.id));
      return data.tasks.filter((t) => workerIds.has(t.assignedToUserId) || t.assignedByUserId === actorId);
    }
    return data.tasks.filter((t) => t.assignedToUserId === actorId);
  }, [data.tasks, scopedTeam, isAdmin, isManager, actorId]);

  // Total monthly estimated wages (strictly employees)
  const totalEstimatedPayroll = useMemo(() => {
    const targetUsers = isAdmin ? data.managedUsers : scopedTeam;
    return targetUsers.reduce((total, user) => {
      if (user.role !== "employee") return total;
      const userAttendance = data.attendance.filter(
        (rec) => rec.employeeId === user.id || (!rec.employeeId && user.id === actorId)
      );
      const { workedDays } = calculateWorkedDays(userAttendance, currentMonth, currentYear);
      const userEarnings = calculateEarnings(workedDays, user.dailyWage || 0);
      return total + userEarnings;
    }, 0);
  }, [data.managedUsers, scopedTeam, data.attendance, currentMonth, currentYear, isAdmin, actorId]);

  // Task stats
  const completedTasks = scopedTasks.filter((t) => t.status === "COMPLETED").length;
  const inProgressTasks = scopedTasks.filter((t) => t.status === "IN_PROGRESS").length;
  const pendingTasks = scopedTasks.filter((t) => t.status === "PENDING").length;
  const completionRate = scopedTasks.length > 0 ? Math.round((completedTasks / scopedTasks.length) * 100) : 0;

  // Employee personal stats
  const myAttendance = data.attendance.filter((a) => a.employeeId === actorId || !a.employeeId);
  const { workedDays: myWorkedDays } = calculateWorkedDays(myAttendance, currentMonth, currentYear);
  const myEstimatedEarnings = calculateEarnings(myWorkedDays, data.session?.dailyWage || 0);

  const completedVisits = data.visits.filter((v) => v.status === "completed");

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.kickerRow}>
              <MaterialIcons color="#D97706" name="insights" size={14} />
              <Text style={styles.kicker}>
                {isAdmin
                  ? "ENTERPRISE INTELLIGENCE"
                  : isManager
                  ? "TEAM PERFORMANCE"
                  : "MY FIELD ACTIVITY"}
              </Text>
            </View>
            <Text style={styles.title}>Reports & Analytics</Text>
            <Text style={styles.subtitle}>
              {isAdmin
                ? "Organization-wide task completion, attendance, and payroll estimates"
                : isManager
                ? "Operational performance of your supervised field crew"
                : "Your verified worked days, task milestones, and earnings"}
            </Text>
          </View>
        </View>

        {/* ADMIN OVERVIEW */}
        {isAdmin ? (
          <>
            <View style={styles.metricsGrid}>
              <MetricCard
                icon="people"
                label="Total Users"
                tone="success"
                value={data.managedUsers.length.toString()}
              />
              <MetricCard
                icon="task-alt"
                label="Completion"
                tone="amber"
                value={`${completionRate}%`}
              />
              <MetricCard
                icon="payments"
                label="Est. Payroll"
                tone="navy"
                value={formatCurrency(totalEstimatedPayroll)}
              />
            </View>

            {/* Route History Monitoring Callout */}
            <SectionHeading title="GPS Field Route History" />
            <Surface style={styles.routeCalloutCard}>
              <View style={styles.routeIconWrap}>
                <MaterialIcons color="#D97706" name="route" size={24} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeTitle}>Day-Wise Route Playback</Text>
                <Text style={styles.routeSubtitle}>
                  Select any worker and calendar date to inspect historical waypoint trails and accuracy logs.
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/location-history" as any)}
                style={styles.openRouteBtn}
              >
                <Text style={styles.openRouteBtnText}>Open Map</Text>
                <MaterialIcons color="#0F172A" name="arrow-forward" size={14} />
              </Pressable>
            </Surface>

            {/* Task Performance Breakdown */}
            <SectionHeading title="Work Order Breakdown" />
            <View style={styles.taskBreakdownGrid}>
              <Surface style={styles.taskBreakdownItem}>
                <Text style={styles.taskBreakdownValue}>{scopedTasks.length}</Text>
                <Text style={styles.taskBreakdownLabel}>Total Orders</Text>
              </Surface>
              <Surface style={styles.taskBreakdownItem}>
                <Text style={[styles.taskBreakdownValue, { color: "#059669" }]}>{completedTasks}</Text>
                <Text style={styles.taskBreakdownLabel}>Completed</Text>
              </Surface>
              <Surface style={styles.taskBreakdownItem}>
                <Text style={[styles.taskBreakdownValue, { color: "#2563EB" }]}>{inProgressTasks}</Text>
                <Text style={styles.taskBreakdownLabel}>In Progress</Text>
              </Surface>
              <Surface style={styles.taskBreakdownItem}>
                <Text style={[styles.taskBreakdownValue, { color: "#D97706" }]}>{pendingTasks}</Text>
                <Text style={styles.taskBreakdownLabel}>Pending</Text>
              </Surface>
            </View>
          </>
        ) : null}

        {/* MANAGER OVERVIEW */}
        {isManager ? (
          <>
            <View style={styles.metricsGrid}>
              <MetricCard
                icon="groups"
                label="Team Members"
                tone="navy"
                value={scopedTeam.length.toString()}
              />
              <MetricCard
                icon="task-alt"
                label="Completion"
                tone="success"
                value={`${completionRate}%`}
              />
              <MetricCard
                icon="assignment"
                label="Team Tasks"
                tone="amber"
                value={scopedTasks.length.toString()}
              />
            </View>

            <SectionHeading title="Team Work Orders" />
            <View style={styles.taskBreakdownGrid}>
              <Surface style={styles.taskBreakdownItem}>
                <Text style={[styles.taskBreakdownValue, { color: "#059669" }]}>{completedTasks}</Text>
                <Text style={styles.taskBreakdownLabel}>Finished</Text>
              </Surface>
              <Surface style={styles.taskBreakdownItem}>
                <Text style={[styles.taskBreakdownValue, { color: "#2563EB" }]}>{inProgressTasks}</Text>
                <Text style={styles.taskBreakdownLabel}>In Progress</Text>
              </Surface>
              <Surface style={styles.taskBreakdownItem}>
                <Text style={[styles.taskBreakdownValue, { color: "#D97706" }]}>{pendingTasks}</Text>
                <Text style={styles.taskBreakdownLabel}>Pending</Text>
              </Surface>
            </View>
          </>
        ) : null}

        {/* EMPLOYEE OVERVIEW */}
        {isEmployee ? (
          <>
            <View style={styles.metricsGrid}>
              <MetricCard
                icon="event-available"
                label="Worked Days"
                tone="success"
                value={`${myWorkedDays} days`}
              />
              <MetricCard
                icon="payments"
                label="Est. Earnings"
                tone="amber"
                value={formatCurrency(myEstimatedEarnings)}
              />
              <MetricCard
                icon="task-alt"
                label="Completed"
                tone="navy"
                value={completedTasks.toString()}
              />
            </View>

            <SectionHeading title="Recent Visit Summaries" />
            {completedVisits.length > 0 ? (
              <View style={styles.visitList}>
                {completedVisits.map((visit) => {
                  const customer = data.customers.find((c) => c.id === visit.customerId);
                  return (
                    <Surface key={visit.id} style={styles.visitCard}>
                      <View style={styles.visitHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.visitCustomer}>{customer?.name ?? "Customer"}</Text>
                          <Text style={styles.visitDate}>{formatDay(visit.checkOutAt ?? visit.scheduledFor)}</Text>
                        </View>
                        <StatusChip
                          label={`${visit.evidenceUris.length} photos`}
                          tone="neutral"
                        />
                      </View>
                      <Text style={styles.visitOutcome}>{visit.meetingOutcome ?? "Visit completed"}</Text>
                    </Surface>
                  );
                })}
              </View>
            ) : (
              <Surface style={styles.empty}>
                <MaterialIcons color="#D97706" name="description" size={30} />
                <Text style={styles.emptyTitle}>No visit reports yet.</Text>
                <Text style={styles.emptyBody}>
                  Complete customer site visits to generate field intelligence reports.
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
  metricsGrid: { flexDirection: "row", gap: 10 },
  routeCalloutCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFDF7",
  },
  routeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  routeTitle: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  routeSubtitle: { color: "#64748B", fontSize: 12, lineHeight: 16, marginTop: 2 },
  openRouteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  openRouteBtnText: { color: "#0F172A", fontSize: 11, fontWeight: "800" },
  taskBreakdownGrid: { flexDirection: "row", gap: 8 },
  taskBreakdownItem: {
    flex: 1,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  taskBreakdownValue: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  taskBreakdownLabel: { color: "#64748B", fontSize: 10, fontWeight: "700" },
  visitList: { gap: 10 },
  visitCard: { padding: 14, gap: 8 },
  visitHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  visitCustomer: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  visitDate: { color: "#64748B", fontSize: 11, marginTop: 1 },
  visitOutcome: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyTitle: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  emptyBody: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 270,
  },
});
