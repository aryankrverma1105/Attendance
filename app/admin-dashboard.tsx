import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import {
  FieldButton,
  MetricCard,
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
  useFieldData,
} from "@/lib/field-data";
import {
  canAccessAdminDashboard,
  canAccessManagerDashboard,
  canSetEmployeeWage,
} from "@/lib/field-access";
import type { FieldRole, ManagedUser } from "@/lib/field-types";
import { trpc } from "@/lib/trpc";

const roleTitle: Record<FieldRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  employee: "Field Employee",
};

export default function AdminDashboardScreen() {
  const router = useRouter();
  const { data, createManagedUser, updateEmployeeWage } = useFieldData();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | FieldRole>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [department, setDepartment] = useState("");
  const [initialWage, setInitialWage] = useState("");
  const [role, setRole] = useState<FieldRole>("employee");

  // Wage modal state
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);

  const actorRole = data.session?.role;
  const actorId = data.session?.id;
  const isAdmin = actorRole === "admin";
  const isManager = actorRole === "manager";
  const hasAccess = canAccessManagerDashboard(actorRole);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const createUserMutation = trpc.workforce.createUser.useMutation();

  // Filter users by scope:
  // Admin sees all users.
  // Manager sees team members (matching managerId or assigned scope).
  const scopedUsers = useMemo(() => {
    if (isAdmin) return data.managedUsers;
    if (isManager) {
      return data.managedUsers.filter(
        (user) => user.managerId === actorId || user.role === "employee"
      );
    }
    return [];
  }, [data.managedUsers, isAdmin, isManager, actorId]);

  const visibleUsers = useMemo(() => {
    return scopedUsers.filter((user) => {
      const matchesQuery = `${user.displayName} ${user.identifier} ${user.role} ${
        user.department ?? ""
      }`
        .toLowerCase()
        .includes(query.trim().toLowerCase());
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      return matchesQuery && matchesRole;
    });
  }, [scopedUsers, query, roleFilter]);

  const activeUsers = scopedUsers.filter((user) => user.status === "active").length;
  const managersCount = scopedUsers.filter((user) => user.role === "manager").length;

  // Calculate total monthly estimated wages strictly for employees (Admin/Manager are salaried)
  const totalEstimatedPayroll = useMemo(() => {
    return scopedUsers.reduce((total, user) => {
      if (user.role !== "employee") return total;
      const userAttendance = data.attendance.filter(
        (rec) => rec.employeeId === user.id || (!rec.employeeId && user.id === actorId)
      );
      const { workedDays } = calculateWorkedDays(userAttendance, currentMonth, currentYear);
      const userEarnings = calculateEarnings(workedDays, user.dailyWage || 0);
      return total + userEarnings;
    }, 0);
  }, [scopedUsers, data.attendance, currentMonth, currentYear, actorId]);

  const createAccount = async () => {
    if (!name.trim() || !identifier.trim()) {
      Alert.alert(
        "Name and Phone Required",
        "Enter the full name and mobile number before creating the user ID."
      );
      return;
    }

    let cleanPhone = identifier.trim();
    if (/^\d{10}$/.test(cleanPhone)) {
      cleanPhone = `+91${cleanPhone}`;
    } else if (!cleanPhone.startsWith("+")) {
      cleanPhone = `+${cleanPhone}`;
    }

    const parsedWage = initialWage.trim() ? Number(initialWage.trim()) : 0;
    const validatedWage = role === "employee" ? (isNaN(parsedWage) || parsedWage < 0 ? 0 : Math.round(parsedWage)) : 0;

    // 1. Local state update
    createManagedUser({
      displayName: name.trim(),
      identifier: cleanPhone,
      role,
      department: department.trim() || undefined,
      dailyWage: validatedWage,
      managerId: role === "employee" && isManager ? actorId : undefined,
    });

    // 2. Server mutation if Admin
    if (isAdmin) {
      await createUserMutation.mutateAsync({
        name: name.trim(),
        phoneE164: cleanPhone,
        role,
        department: department.trim() || undefined,
        dailyWage: validatedWage,
      }).catch((err: unknown) => {
        console.warn("[Admin] Server user creation sync queued:", err);
      });
    }

    setName("");
    setIdentifier("");
    setDepartment("");
    setInitialWage("");
    setRole("employee");
    setShowCreate(false);
    Alert.alert(
      "Account invitation created",
      "The account invitation and configured daily wage have been safely queued."
    );
  };

  if (!hasAccess) {
    return (
      <ScreenContainer containerClassName="bg-background" className="p-5 justify-center">
        <Surface style={styles.restricted}>
          <MaterialIcons color="#F59E0B" name="admin-panel-settings" size={38} />
          <Text style={styles.restrictedTitle}>Management Access Required</Text>
          <Text style={styles.restrictedBody}>
            Only server-authorized Administrators and Managers can access this workforce
            management dashboard.
          </Text>
          <FieldButton
            icon="arrow-back"
            label="Return to Home"
            onPress={() => router.replace("/(tabs)")}
            style={{ width: "100%" }}
          />
        </Surface>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <MaterialIcons color="#0B192C" name="arrow-back" size={22} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={styles.kickerRow}>
              <MaterialIcons color="#D97706" name="shield" size={14} />
              <Text style={styles.kicker}>
                {isAdmin ? "ENTERPRISE WORKFORCE CONTROL" : "TEAM MANAGEMENT"}
              </Text>
            </View>
            <Text style={styles.title}>
              {isAdmin ? "Admin Dashboard" : "Manager Dashboard"}
            </Text>
            <Text style={styles.subtitle}>
              {isAdmin
                ? "Manage accounts, role assignments, wages, and payroll."
                : "Manage assigned team members, attendance, and wages."}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowCreate((value) => !value)}
            style={styles.addButton}
          >
            <MaterialIcons
              color="#0B192C"
              name={showCreate ? "close" : "person-add"}
              size={21}
            />
          </Pressable>
        </View>

        {/* High-level KPIs */}
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="groups"
            label={isAdmin ? "Active Users" : "Team Members"}
            subtitle={`${activeUsers} active / ${scopedUsers.length} total`}
            tone="navy"
            value={String(activeUsers)}
          />
          <MetricCard
            icon="payments"
            label="Monthly Wages"
            subtitle="Estimated Payout"
            tone="success"
            value={formatCurrency(totalEstimatedPayroll)}
          />
        </View>

        {/* Create Invitation Form */}
        {showCreate ? (
          <Surface style={styles.formCard}>
            <Text style={styles.formTitle}>Create Account Invitation</Text>
            <Text style={styles.formBody}>
              Set up the employee account profile, role, and initial per-day wage rate.
            </Text>

            <TextInput
              onChangeText={setName}
              placeholder="Full name (e.g. Aryan Kumar)"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              value={name}
            />
            <TextInput
              autoCapitalize="none"
              onChangeText={setIdentifier}
              placeholder="Mobile number (+91...) or work email"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              value={identifier}
            />
            <TextInput
              onChangeText={setDepartment}
              placeholder="Department / Territory (e.g. Solar Field Ops)"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              value={department}
            />

            <View style={styles.wageInputWrap}>
              <Text style={styles.inputLabel}>INITIAL DAILY WAGE (INR)</Text>
              <TextInput
                keyboardType="numeric"
                onChangeText={setInitialWage}
                placeholder="₹ Daily wage (e.g. 700)"
                placeholderTextColor="#94A3B8"
                style={styles.input}
                value={initialWage}
              />
            </View>

            <Text style={styles.inputLabel}>ACCOUNT ROLE</Text>
            <View style={styles.rolesRow}>
              {(isAdmin ? (["employee", "manager", "admin"] as FieldRole[]) : (["employee"] as FieldRole[])).map(
                (item) => (
                  <Pressable
                    key={item}
                    onPress={() => setRole(item)}
                    style={[styles.roleChip, role === item && styles.roleChipActive]}
                  >
                    <Text style={[styles.roleText, role === item && styles.roleTextActive]}>
                      {roleTitle[item]}
                    </Text>
                  </Pressable>
                )
              )}
            </View>

            <FieldButton
              icon="person-add"
              label="Save & Queue Invitation"
              onPress={createAccount}
              style={{ marginTop: 6 }}
            />
          </Surface>
        ) : null}

        {/* Directory Search & Filters */}
        <SectionHeading
          subtitle={`${visibleUsers.length} employee${visibleUsers.length === 1 ? "" : "s"} listed`}
          title="Workforce & Wage Directory"
        />

        <TextInput
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder="Search by name, role, mobile, or department..."
          placeholderTextColor="#94A3B8"
          style={styles.search}
          value={query}
        />

        {/* Role filter chips */}
        <View style={styles.filterRow}>
          {(["all", "employee", "manager", "admin"] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => setRoleFilter(item)}
              style={[styles.filterChip, roleFilter === item && styles.filterChipActive]}
            >
              <Text
                style={[
                  styles.filterText,
                  roleFilter === item && styles.filterTextActive,
                ]}
              >
                {item === "all" ? "All" : roleTitle[item]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Employee Directory Cards */}
        {visibleUsers.length > 0 ? (
          <View style={styles.directory}>
            {visibleUsers.map((emp) => {
              const empAttendance = data.attendance.filter(
                (rec) => rec.employeeId === emp.id || (!rec.employeeId && emp.id === actorId)
              );
              const { workedDays: empWorkedDays } = calculateWorkedDays(
                empAttendance,
                currentMonth,
                currentYear
              );
              const empEarnings = calculateEarnings(empWorkedDays, emp.dailyWage || 0);

              const canEditThisWage = canSetEmployeeWage({
                actorRole,
                actorId,
                targetUserId: emp.id,
                targetUserRole: emp.role,
                targetManagerId: emp.managerId,
              });

              return (
                <Surface key={emp.id} style={styles.userCard}>
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: "/employee-detail", params: { id: emp.id } })
                    }
                    style={styles.userTop}
                  >
                    <View style={styles.userAvatar}>
                      <Text style={styles.userInitial}>
                        {emp.displayName.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.userName}>{emp.displayName}</Text>
                      <Text style={styles.userMeta}>{emp.identifier}</Text>
                      <Text style={styles.userMeta}>
                        {emp.department ? `${emp.department} · ` : ""}
                        {roleTitle[emp.role]}
                      </Text>
                    </View>
                    <StatusChip
                      label={
                        emp.status === "active"
                          ? "Active"
                          : emp.status === "invited"
                          ? "Invited"
                          : "Suspended"
                      }
                      tone={
                        emp.status === "active"
                          ? "success"
                          : emp.status === "invited"
                          ? "warning"
                          : "danger"
                      }
                    />
                  </Pressable>

                  <View style={styles.userDivider} />

                  {/* Financial & Worked-Days Summary Bar */}
                  {emp.role === "employee" ? (
                    <View style={styles.userFinancialRow}>
                      <View style={styles.wageCol}>
                        <Text style={styles.financialLabel}>DAILY WAGE</Text>
                        <Text style={styles.wageValue}>{formatCurrency(emp.dailyWage)}/day</Text>
                      </View>

                      <View style={styles.wageCol}>
                        <Text style={styles.financialLabel}>WORKED DAYS</Text>
                        <Text style={styles.financialValue}>{empWorkedDays} days</Text>
                      </View>

                      <View style={styles.wageCol}>
                        <Text style={styles.financialLabel}>MONTH EARNINGS</Text>
                        <Text style={styles.earningsValue}>{formatCurrency(empEarnings)}</Text>
                      </View>

                      {canEditThisWage ? (
                        <Pressable
                          onPress={() => setEditingUser(emp)}
                          style={styles.editWageButton}
                        >
                          <MaterialIcons color="#0B192C" name="edit" size={14} />
                          <Text style={styles.editWageText}>Edit</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.userSalariedRow}>
                      <MaterialIcons color="#D97706" name="shield" size={16} />
                      <Text style={styles.salariedText}>Salaried Management · No Daily Wage / Check-in</Text>
                    </View>
                  )}
                </Surface>
              );
            })}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#F59E0B" name="search-off" size={32} />
            <Text style={styles.emptyTitle}>No matching employees.</Text>
            <Text style={styles.emptyBody}>
              Clear the search filter or create a new account invitation.
            </Text>
          </Surface>
        )}

        {/* Wage Edit Modal */}
        {editingUser ? (
          <WageEditModal
            currentWage={editingUser.dailyWage || 0}
            employeeName={editingUser.displayName}
            onClose={() => setEditingUser(null)}
            onSave={(newWage) => {
              updateEmployeeWage(editingUser.id, newWage);
              setEditingUser(null);
            }}
            visible={Boolean(editingUser)}
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
  title: { color: "#0B192C", fontSize: 23, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: "#64748B", fontSize: 12, marginTop: 2 },
  addButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    alignItems: "center",
    justifyContent: "center",
  },
  metricsGrid: { flexDirection: "row", gap: 10 },
  formCard: { gap: 10, borderColor: "#FDE68A", backgroundColor: "#FFFDF7" },
  formTitle: { color: "#0B192C", fontSize: 16, fontWeight: "900" },
  formBody: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    color: "#0B192C",
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 13,
    fontSize: 14,
  },
  wageInputWrap: { gap: 6 },
  inputLabel: {
    color: "#D97706",
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: "900",
    marginTop: 4,
  },
  rolesRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  roleChip: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  roleChipActive: { borderColor: "#F59E0B", backgroundColor: "#FEF3C7" },
  roleText: { color: "#64748B", fontSize: 11, fontWeight: "700" },
  roleTextActive: { color: "#92400E", fontWeight: "900" },
  search: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    color: "#0B192C",
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 13,
    fontSize: 13,
  },
  filterRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  filterChip: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 10,
  },
  filterChipActive: { borderColor: "#F59E0B", backgroundColor: "#FEF3C7" },
  filterText: { color: "#64748B", fontSize: 11, fontWeight: "700" },
  filterTextActive: { color: "#92400E", fontWeight: "900" },
  directory: { gap: 10 },
  userCard: { padding: 14, gap: 10 },
  userTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  userInitial: { color: "#92400E", fontWeight: "900", fontSize: 18 },
  userName: { color: "#0B192C", fontSize: 15, fontWeight: "900" },
  userMeta: { color: "#64748B", fontSize: 11, lineHeight: 15 },
  userDivider: { height: 1, backgroundColor: "#F1F5F9" },
  userFinancialRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: 12,
  },
  wageCol: { gap: 2 },
  financialLabel: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  wageValue: { color: "#0B192C", fontSize: 13, fontWeight: "800" },
  financialValue: { color: "#0B192C", fontSize: 13, fontWeight: "800" },
  earningsValue: { color: "#059669", fontSize: 13, fontWeight: "900" },
  editWageButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  editWageText: { color: "#0B192C", fontSize: 11, fontWeight: "800" },
  userSalariedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    borderWidth: 1,
    padding: 10,
    borderRadius: 12,
  },
  salariedText: { color: "#92400E", fontSize: 12, fontWeight: "700" },
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
