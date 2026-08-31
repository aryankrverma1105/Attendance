import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatCurrency, useFieldData } from "@/lib/field-data";
import { clearUserInfo, removeSessionToken } from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";

export default function ProfileScreen() {
  const router = useRouter();
  const { data, signOut, setNotificationsEnabled } = useFieldData();
  const user = data.session;
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleSignOut = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Ignore network error during local/preview signOut
    }
    await clearUserInfo();
    await removeSessionToken();
    signOut();
    router.replace("/login");
  };

  const requestSignOut = () => {
    if (Platform.OS === "web") {
      const confirmed = typeof window !== "undefined"
        ? window.confirm("Sign out of Sologix?\nActive route tracking will be stopped and your session will be cleared.")
        : true;
      if (confirmed) {
        handleSignOut();
      }
      return;
    }

    Alert.alert(
      "Sign out of Sologix?",
      "Active route tracking will be stopped and the secure session will be removed from this device.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: handleSignOut },
      ]
    );
  };

  const managedUser = data.managedUsers.find((u) => {
    const digits = (user?.identifier || "").replace(/[^0-9]/g, "");
    const uDigits = (u.identifier || "").replace(/[^0-9]/g, "");
    return (digits && uDigits && uDigits === digits) || (user?.id && u.id === user.id);
  });

  const userDisplayName =
    (managedUser?.displayName && managedUser.displayName !== "Field employee" && managedUser.displayName !== "Field Employee"
      ? managedUser.displayName
      : null) ||
    (user?.displayName && user.displayName !== "Field employee" && user.displayName !== "Field Employee"
      ? user.displayName
      : null) ||
    (user?.role === "admin" || user?.identifier?.includes("9835916278")
      ? "Aryan Kumar Verma"
      : user?.identifier || "Field Employee");

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={styles.profileTop}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {userDisplayName.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{userDisplayName}</Text>
            <Text style={styles.identifier}>{user?.identifier ?? "No identifier"}</Text>
            <StatusChip
              label={
                user?.role === "admin"
                  ? "Administrator"
                  : user?.role === "manager"
                  ? "Field Manager"
                  : "Field Employee"
              }
              tone="solar"
            />
          </View>
          <Pressable onPress={() => router.push("/offline-queue")} style={styles.queue}>
            <MaterialIcons color="#D97706" name="sync" size={20} />
          </Pressable>
        </View>

        {/* Compensation Card */}
        <SectionHeading title="Compensation & Payout" />
        <Surface style={styles.compensationCard}>
          <View style={styles.compensationHeader}>
            <View style={styles.compensationIconWrap}>
              <MaterialIcons color="#D97706" name={user?.role === "employee" ? "payments" : "badge"} size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.compensationTitle}>
                {user?.role === "employee"
                  ? user?.dailyWage ? formatCurrency(user.dailyWage) + " / day" : "Daily Wage Rate"
                  : "Salaried Management"}
              </Text>
              <Text style={styles.compensationSubtitle}>
                {user?.role === "employee"
                  ? "Configured per-day wage rate"
                  : "Fixed monthly management payroll · Excluded from daily wage"}
              </Text>
            </View>
            {user?.role === "employee" ? (
              <Pressable onPress={() => router.push("/earnings" as any)} style={styles.earningsLinkButton}>
                <Text style={styles.earningsLinkText}>View Payouts</Text>
                <MaterialIcons color="#0B192C" name="arrow-forward" size={15} />
              </Pressable>
            ) : null}
          </View>
        </Surface>

        {/* Administration shortcuts */}
        {user?.role === "admin" || user?.role === "manager" ? (
          <>
            <SectionHeading title="Management Workspace" />
            <Surface style={styles.adminCard}>
              <View style={styles.adminIcon}>
                <MaterialIcons color="#D97706" name="admin-panel-settings" size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.adminTitle}>
                  {user?.role === "admin" ? "Enterprise Workforce Control" : "Team Workforce Control"}
                </Text>
                <Text style={styles.adminBody}>
                  Manage account invitations, assign daily wages, inspect GPS routes and attendance.
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/admin-dashboard")}
                style={styles.adminButton}
              >
                <MaterialIcons color="#0B192C" name="arrow-forward" size={19} />
              </Pressable>
            </Surface>
          </>
        ) : null}

        {/* Tracking alerts for admin/manager */}
        {user?.role === "admin" || user?.role === "manager" ? (
          <>
            <SectionHeading title="Tracking Alerts" />
            {data.trackingPermissionAlerts.length > 0 ? (
              <View style={styles.alertList}>
                {data.trackingPermissionAlerts.map((alert) => (
                  <Surface key={alert.id} style={styles.alertCard}>
                    <View style={styles.alertIcon}>
                      <MaterialIcons color="#DC2626" name="location-off" size={20} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alertTitle}>
                        {alert.employeeName} denied route tracking
                      </Text>
                      <Text style={styles.alertBody}>
                        Manager notification queued for delivery.
                      </Text>
                    </View>
                    <StatusChip label="Queued" tone="warning" />
                  </Surface>
                ))}
              </View>
            ) : (
              <Surface style={styles.alertEmpty}>
                <MaterialIcons color="#10B981" name="location-on" size={21} />
                <Text style={styles.alertEmptyText}>No tracking permission alerts active.</Text>
              </Surface>
            )}
          </>
        ) : null}

        {/* Preferences & Transparency */}
        <SectionHeading title="Settings & Privacy" />
        <Surface style={styles.option}>
          <View style={styles.optionIcon}>
            <MaterialIcons color="#0284C7" name="notifications-active" size={21} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>Work notifications</Text>
            <Text style={styles.optionBody}>Shift reminders, visit itineraries, and alerts.</Text>
          </View>
          <Switch
            onValueChange={setNotificationsEnabled}
            thumbColor={data.notificationsEnabled ? "#F59E0B" : "#FFFFFF"}
            trackColor={{ false: "#CBD5E1", true: "#FDE68A" }}
            value={data.notificationsEnabled}
          />
        </Surface>

        <Surface style={styles.option}>
          <View style={styles.optionIcon}>
            <MaterialIcons color="#D97706" name="location-on" size={21} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>Location Transparency</Text>
            <Text style={styles.optionBody}>
              {data.trackingActive ? "GPS route tracking is active." : "Route tracking is paused."}
            </Text>
          </View>
          <StatusChip
            label={data.trackingActive ? "Active" : "Paused"}
            tone={data.trackingActive ? "success" : "neutral"}
          />
        </Surface>

        {/* Product info */}
        <SectionHeading title="Organization" />
        <Surface style={styles.developerCard}>
          <View style={styles.developerIcon}>
            <MaterialIcons color="#D97706" name="solar-power" size={24} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.developerTitle}>Sologix Energy Pvt Ltd</Text>
            <Text style={styles.developerBody}>Energizing Naturally · Made by Aryan Kumar Verma</Text>
          </View>
        </Surface>

        <FieldButton
          icon="logout"
          label="Sign out of workspace"
          onPress={requestSignOut}
          variant="danger"
        />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 18, paddingBottom: 36 },
  profileTop: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#92400E", fontSize: 24, fontWeight: "900" },
  name: { color: "#0B192C", fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  identifier: { color: "#64748B", fontSize: 12, marginTop: 2, marginBottom: 6 },
  queue: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  compensationCard: {
    padding: 14,
    borderColor: "#FDE68A",
    backgroundColor: "#FFFDF7",
  },
  compensationHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  compensationIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  compensationTitle: { color: "#0B192C", fontSize: 16, fontWeight: "900" },
  compensationSubtitle: { color: "#64748B", fontSize: 11, marginTop: 2 },
  earningsLinkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  earningsLinkText: { color: "#0B192C", fontSize: 11, fontWeight: "800" },
  adminCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  adminIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "#FEF3C7",
    justifyContent: "center",
    alignItems: "center",
  },
  adminTitle: { color: "#0B192C", fontSize: 14, fontWeight: "900" },
  adminBody: { color: "#64748B", fontSize: 11, lineHeight: 16, marginTop: 2 },
  adminButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    justifyContent: "center",
    alignItems: "center",
  },
  alertList: { gap: 10 },
  alertCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  alertIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  alertTitle: { color: "#0B192C", fontSize: 13, fontWeight: "800" },
  alertBody: { color: "#64748B", fontSize: 11, marginTop: 2 },
  alertEmpty: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  alertEmptyText: { color: "#64748B", fontSize: 12, fontWeight: "700" },
  option: { flexDirection: "row", alignItems: "center", gap: 12 },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: { color: "#0B192C", fontSize: 14, fontWeight: "800" },
  optionBody: { color: "#64748B", fontSize: 11, lineHeight: 16, marginTop: 2 },
  developerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  developerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  developerTitle: { color: "#0B192C", fontSize: 14, fontWeight: "900" },
  developerBody: { color: "#64748B", fontSize: 11, lineHeight: 16, marginTop: 2 },
});
