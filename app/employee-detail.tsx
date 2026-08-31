import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { RouteMap } from "@/components/route-map";
import {
  FieldButton,
  SectionHeading,
  StatusChip,
  Surface,
  WageEditModal,
} from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import {
  calculateEarnings,
  calculateWorkedDays,
  formatCurrency,
  formatDay,
  formatTime,
  routeDistanceKm,
  useFieldData,
} from "@/lib/field-data";
import { canSetEmployeeWage, canViewEmployeeRecord } from "@/lib/field-access";
import { canAdminManageAccount, canRemoveManagedAccount } from "@/lib/account-lifecycle";

const lifecycleCopy = {
  "account-created": "Account invitation created",
  "access-issued": "Account access issued",
  "account-removed": "Account removed",
} as const;

export default function EmployeeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, issueManagedUserAccess, removeManagedUser, updateEmployeeWage } = useFieldData();
  const [showWageModal, setShowWageModal] = useState(false);

  const user = data.managedUsers.find((item) => item.id === id);
  const isCurrentWorkspaceUser = data.session?.id === id;
  const actorRole = data.session?.role;
  const actorId = data.session?.id;

  const canView = canViewEmployeeRecord({
    viewerRole: actorRole,
    viewerId: actorId,
    employeeId: id,
    targetManagerId: user?.managerId,
  });

  const canEditWage = user
    ? canSetEmployeeWage({
        actorRole,
        actorId,
        targetUserId: user.id,
        targetUserRole: user.role,
        targetManagerId: user.managerId,
      })
    : false;

  const isAdmin = canAdminManageAccount(actorRole);
  const canDelete = canRemoveManagedAccount({
    role: actorRole,
    actorId,
    targetUserId: id,
  });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const attendance = data.attendance.filter(
    (record) => record.employeeId === id || (isCurrentWorkspaceUser && !record.employeeId)
  );
  const visits = data.visits.filter(
    (visit) => visit.employeeId === id || (isCurrentWorkspaceUser && !visit.employeeId)
  );
  const routePoints = data.routePoints.filter(
    (point) => point.employeeId === id || (isCurrentWorkspaceUser && !point.employeeId)
  );
  const accountEvents = data.accountEvents.filter((event) => event.userId === id);
  const distance = routeDistanceKm(routePoints);
  const completedVisits = visits.filter((visit) => visit.status === "completed");

  const { workedDays } = useMemo(
    () => calculateWorkedDays(attendance, currentMonth, currentYear),
    [attendance, currentMonth, currentYear]
  );
  const monthEarnings = useMemo(
    () => calculateEarnings(workedDays, user?.dailyWage || 0),
    [workedDays, user?.dailyWage]
  );

  const issueAccess = () => {
    if (!user) return;
    const issued = issueManagedUserAccess(user.id);
    Alert.alert(
      issued ? "Account access queued" : "Access not issued",
      issued
        ? `A linked account access invitation for ${user.displayName} is now queued for secure OTP delivery.`
        : "Only an administrator can issue access for this account."
    );
  };

  const requestRemoval = () => {
    if (!user) return;
    if (Platform.OS === "web") {
      const confirmed = typeof window !== "undefined"
        ? window.confirm(`Remove ${user.displayName}'s account?\nThe account will be removed from the active user directory. Attendance, visit, and route records are retained for audit.`)
        : true;
      if (confirmed) {
        removeManagedUser(user.id);
        router.replace("/admin-dashboard");
      }
      return;
    }

    Alert.alert(
      `Remove ${user.displayName}'s account?`,
      "The account will be removed from the active user directory. Attendance, visit, and route records are retained for audit.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove account",
          style: "destructive",
          onPress: () => {
            removeManagedUser(user.id);
            router.replace("/admin-dashboard");
          },
        },
      ]
    );
  };

  if (!user || !canView) {
    return (
      <ScreenContainer containerClassName="bg-background" className="p-5 justify-center">
        <Surface style={styles.restricted}>
          <MaterialIcons color="#F59E0B" name="lock" size={34} />
          <Text style={styles.restrictedTitle}>Employee Record Unavailable</Text>
          <Text style={styles.restrictedBody}>
            Administrators can open all authorized employee records. Managers can access
            assigned team members.
          </Text>
          <FieldButton
            icon="arrow-back"
            label="Return to directory"
            onPress={() => router.replace("/admin-dashboard")}
            style={{ width: "100%" }}
          />
        </Surface>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <MaterialIcons color="#0B192C" name="arrow-back" size={22} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={styles.kickerRow}>
              <MaterialIcons color="#D97706" name="badge" size={14} />
              <Text style={styles.kicker}>EMPLOYEE PROFILE</Text>
            </View>
            <Text style={styles.title}>{user.displayName}</Text>
            <Text style={styles.subtitle}>{user.identifier}</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
        </View>

        {/* Profile Details Card */}
        <Surface style={styles.profileCard}>
          <View style={styles.profileTop}>
            <View>
              <Text style={styles.profileLabel}>ASSIGNED ROLE</Text>
              <Text style={styles.profileValue}>
                {user.role === "admin"
                  ? "Administrator"
                  : user.role === "manager"
                  ? "Manager"
                  : "Field Employee"}
              </Text>
            </View>
            <StatusChip
              label={user.status === "active" ? "Active" : "Invitation queued"}
              tone={user.status === "active" ? "success" : "warning"}
            />
          </View>
          <Text style={styles.profileMeta}>
            {user.department ? `${user.department} · ` : ""}Registered {formatDay(user.createdAt)}
          </Text>
          <Text style={styles.linkMeta}>Account ID: {user.accountLinkId}</Text>
        </Surface>

        {/* Compensation & Daily Wage Card */}
        <SectionHeading
          action={
            canEditWage ? (
              <Pressable
                onPress={() => setShowWageModal(true)}
                style={styles.editWageHeaderButton}
              >
                <MaterialIcons color="#0B192C" name="edit" size={14} />
                <Text style={styles.editWageHeaderText}>Edit Wage</Text>
              </Pressable>
            ) : null
          }
          subtitle="Configured compensation & calculated monthly earnings"
          title="Compensation"
        />
        <Surface style={styles.compensationCard}>
          <View style={styles.compensationHeader}>
            <View style={styles.compensationIconWrap}>
              <MaterialIcons color="#D97706" name="payments" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.compensationTitle}>
                {formatCurrency(user.dailyWage || 0)}
                <Text style={styles.compensationUnit}> / day</Text>
              </Text>
              <Text style={styles.compensationSubtitle}>
                {user.dailyWage ? "Configured Per-Day Wage" : "Wage rate not yet configured"}
              </Text>
            </View>
          </View>

          <View style={styles.compensationDivider} />

          <View style={styles.compensationRow}>
            <View style={styles.compensationCol}>
              <Text style={styles.compensationLabel}>WORKED DAYS</Text>
              <Text style={styles.compensationValue}>{workedDays} Days</Text>
              <Text style={styles.compensationNote}>This Month</Text>
            </View>

            <View style={styles.compensationColDivider} />

            <View style={styles.compensationCol}>
              <Text style={styles.compensationLabel}>MONTH EARNINGS</Text>
              <Text style={styles.earningsValue}>{formatCurrency(monthEarnings)}</Text>
              <Text style={styles.compensationNote}>Calculated</Text>
            </View>
          </View>
        </Surface>

        {/* Account Access Actions for Admin */}
        {isAdmin ? (
          <>
            <SectionHeading title="Account Management" />
            <Surface style={styles.accountCard}>
              <View style={styles.accountIcon}>
                <MaterialIcons color="#D97706" name="vpn-key" size={21} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountTitle}>
                  {user.status === "active"
                    ? "Reissue Account Access"
                    : "Issue Linked Account Access"}
                </Text>
                <Text style={styles.accountBody}>
                  {user.status === "active"
                    ? `Access last issued ${formatDay(user.accessIssuedAt)}. You can queue another secure onboarding invitation if needed.`
                    : "Generate and send the secure onboarding invitation for this user."}
                </Text>
              </View>
            </Surface>
            <FieldButton
              icon="send"
              label={user.status === "active" ? "Reissue access OTP" : "Issue access OTP"}
              onPress={issueAccess}
              variant="secondary"
            />
            {canDelete ? (
              <FieldButton
                icon="delete-outline"
                label="Remove user account"
                onPress={requestRemoval}
                variant="danger"
              />
            ) : (
              <Text style={styles.selfDeleteNote}>
                You cannot remove your own active administrator account.
              </Text>
            )}
          </>
        ) : null}

        {/* Overview Stats */}
        <View style={styles.metricsRow}>
          <Surface style={styles.metricCard}>
            <MaterialIcons color="#10B981" name="how-to-reg" size={21} />
            <Text style={styles.metricValue}>{attendance.length}</Text>
            <Text style={styles.metricLabel}>Attendance Log</Text>
          </Surface>
          <Surface style={styles.metricCard}>
            <MaterialIcons color="#0284C7" name="task-alt" size={21} />
            <Text style={styles.metricValue}>{completedVisits.length}</Text>
            <Text style={styles.metricLabel}>Completed Visits</Text>
          </Surface>
          <Surface style={styles.metricCard}>
            <MaterialIcons color="#D97706" name="route" size={21} />
            <Text style={styles.metricValue}>{distance.toFixed(1)} km</Text>
            <Text style={styles.metricLabel}>Route Distance</Text>
          </Surface>
        </View>

        {/* Attendance Records */}
        <SectionHeading title="Attendance Records" />
        {attendance.length > 0 ? (
          <View style={styles.list}>
            {attendance.map((record) => (
              <Surface key={record.id} style={styles.recordCard}>
                <View style={styles.recordTop}>
                  <View>
                    <Text style={styles.recordDate}>{formatDay(record.checkInAt)}</Text>
                    <Text style={styles.recordTime}>
                      {formatTime(record.checkInAt)} → {formatTime(record.checkOutAt)}
                    </Text>
                  </View>
                  <StatusChip
                    label={record.status === "verified" ? "GPS Verified" : "Review Location"}
                    tone={record.status === "verified" ? "success" : "warning"}
                  />
                </View>
                <Text style={styles.recordMeta}>
                  Accuracy:{" "}
                  {record.checkInLocation?.accuracy !== null &&
                  record.checkInLocation?.accuracy !== undefined
                    ? `±${Math.round(record.checkInLocation.accuracy)} m`
                    : "Standard"}{" "}
                  · {record.checkInPhotoUri ? "Photo evidence captured" : "No photo"}
                </Text>
              </Surface>
            ))}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#F59E0B" name="event-busy" size={28} />
            <Text style={styles.emptyTitle}>No attendance records found.</Text>
            <Text style={styles.emptyBody}>
              Verified field check-ins will automatically log here.
            </Text>
          </Surface>
        )}

        {/* Route Tracking Map */}
        <SectionHeading
          action={
            <Pressable
              onPress={() => router.push({ pathname: "/location-history", params: { employeeId: user.id } })}
              style={styles.historyActionBtn}
            >
              <MaterialIcons color="#D97706" name="calendar-today" size={14} />
              <Text style={styles.historyActionText}>Day-wise history</Text>
            </Pressable>
          }
          subtitle="Real-time waypoint trail and location timeline"
          title="GPS Route Map"
        />
        <RouteMap points={routePoints} />

        {/* Customer Visits */}
        <SectionHeading title="Customer Visit Activity" />
        {visits.length > 0 ? (
          <View style={styles.list}>
            {visits.map((visit) => {
              const customer = data.customers.find((item) => item.id === visit.customerId);
              return (
                <Surface key={visit.id} style={styles.visitCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.visitTitle}>{customer?.name ?? "Solar Customer"}</Text>
                    <Text style={styles.visitMeta}>
                      {formatDay(visit.scheduledFor)} ·{" "}
                      {visit.status === "completed"
                        ? "Completed"
                        : visit.status === "checked-in"
                        ? "At Site"
                        : "Scheduled"}
                    </Text>
                    <Text style={styles.visitMeta}>
                      {visit.evidenceUris.length} photo{visit.evidenceUris.length === 1 ? "" : "s"}{" "}
                      evidence
                      {visit.meetingOutcome ? ` · ${visit.meetingOutcome}` : ""}
                    </Text>
                  </View>
                  <MaterialIcons
                    color={visit.status === "completed" ? "#10B981" : "#D97706"}
                    name={visit.status === "completed" ? "task-alt" : "pending-actions"}
                    size={22}
                  />
                </Surface>
              );
            })}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#F59E0B" name="storefront" size={28} />
            <Text style={styles.emptyTitle}>No customer visits logged.</Text>
            <Text style={styles.emptyBody}>
              Scheduled client visits and inspection evidence will appear here.
            </Text>
          </Surface>
        )}

        {/* Account Lifecycle */}
        <SectionHeading title="Account Lifecycle & Audit" />
        {accountEvents.length > 0 ? (
          <View style={styles.list}>
            {accountEvents.map((event) => (
              <Surface key={event.id} style={styles.lifecycleCard}>
                <MaterialIcons
                  color={
                    event.action === "account-removed"
                      ? "#DC2626"
                      : event.action === "access-issued"
                      ? "#10B981"
                      : "#D97706"
                  }
                  name={
                    event.action === "account-removed"
                      ? "person-remove"
                      : event.action === "access-issued"
                      ? "mark-email-read"
                      : "person-add"
                  }
                  size={20}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.lifecycleTitle}>{lifecycleCopy[event.action]}</Text>
                  <Text style={styles.lifecycleBody}>{event.detail}</Text>
                  <Text style={styles.lifecycleTime}>
                    {formatDay(event.occurredAt)} · {formatTime(event.occurredAt)}
                  </Text>
                </View>
              </Surface>
            ))}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#F59E0B" name="history" size={28} />
            <Text style={styles.emptyTitle}>No lifecycle events recorded.</Text>
          </Surface>
        )}

        {/* Wage Edit Modal */}
        {showWageModal ? (
          <WageEditModal
            currentWage={user.dailyWage || 0}
            employeeName={user.displayName}
            onClose={() => setShowWageModal(false)}
            onSave={(newWage) => {
              updateEmployeeWage(user.id, newWage);
              setShowWageModal(false);
            }}
            visible={showWageModal}
          />
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 18, paddingBottom: 36 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 },
  kicker: { color: "#D97706", fontSize: 10, letterSpacing: 1.2, fontWeight: "900" },
  title: { color: "#0B192C", fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  subtitle: { color: "#64748B", fontSize: 11, marginTop: 2 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#92400E", fontSize: 19, fontWeight: "900" },
  profileCard: { gap: 8 },
  profileTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  profileLabel: { color: "#D97706", fontSize: 10, letterSpacing: 1.1, fontWeight: "900" },
  profileValue: { color: "#0B192C", fontSize: 15, fontWeight: "800", marginTop: 3 },
  profileMeta: { color: "#64748B", fontSize: 12 },
  linkMeta: { color: "#94A3B8", fontSize: 11, fontWeight: "600" },
  editWageHeaderButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  editWageHeaderText: { color: "#0B192C", fontSize: 12, fontWeight: "800" },
  historyActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  historyActionText: { color: "#D97706", fontSize: 12, fontWeight: "800" },
  compensationCard: {
    padding: 16,
    gap: 12,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFDF7",
  },
  compensationHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  compensationIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  compensationTitle: { color: "#0B192C", fontSize: 20, fontWeight: "900" },
  compensationUnit: { color: "#64748B", fontSize: 13, fontWeight: "600" },
  compensationSubtitle: { color: "#64748B", fontSize: 12, marginTop: 2 },
  compensationDivider: { height: 1, backgroundColor: "#F1F5F9" },
  compensationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  compensationCol: { flex: 1 },
  compensationLabel: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  compensationValue: { color: "#0B192C", fontSize: 16, fontWeight: "800" },
  earningsValue: { color: "#059669", fontSize: 17, fontWeight: "900" },
  compensationNote: { color: "#64748B", fontSize: 10, marginTop: 2 },
  compensationColDivider: {
    width: 1,
    height: 36,
    backgroundColor: "#E2E8F0",
    marginHorizontal: 16,
  },
  accountCard: {
    flexDirection: "row",
    gap: 11,
    alignItems: "flex-start",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  accountTitle: { color: "#0B192C", fontSize: 14, fontWeight: "800" },
  accountBody: { color: "#64748B", fontSize: 12, lineHeight: 17, marginTop: 3 },
  selfDeleteNote: { color: "#94A3B8", fontSize: 11, lineHeight: 16, paddingHorizontal: 2 },
  metricsRow: { flexDirection: "row", gap: 9 },
  metricCard: { flex: 1, minHeight: 110, padding: 12, gap: 6 },
  metricValue: { color: "#0B192C", fontSize: 19, fontWeight: "900", marginTop: 2 },
  metricLabel: { color: "#64748B", fontSize: 10, lineHeight: 14 },
  list: { gap: 9 },
  recordCard: { gap: 8 },
  recordTop: { flexDirection: "row", justifyContent: "space-between", gap: 9 },
  recordDate: { color: "#0B192C", fontSize: 14, fontWeight: "800" },
  recordTime: { color: "#64748B", fontSize: 11, marginTop: 2 },
  recordMeta: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  visitCard: { flexDirection: "row", alignItems: "center", gap: 10 },
  visitTitle: { color: "#0B192C", fontSize: 14, fontWeight: "800" },
  visitMeta: { color: "#64748B", fontSize: 11, lineHeight: 16, marginTop: 2 },
  lifecycleCard: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  lifecycleTitle: { color: "#0B192C", fontSize: 13, fontWeight: "800" },
  lifecycleBody: { color: "#64748B", fontSize: 11, lineHeight: 16, marginTop: 2 },
  lifecycleTime: { color: "#94A3B8", fontSize: 10, marginTop: 4 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyTitle: { color: "#0B192C", fontSize: 15, fontWeight: "800" },
  emptyBody: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 280,
  },
  restricted: { alignItems: "center", gap: 12, paddingVertical: 34 },
  restrictedTitle: { color: "#0B192C", fontSize: 18, fontWeight: "800" },
  restrictedBody: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
  },
});
