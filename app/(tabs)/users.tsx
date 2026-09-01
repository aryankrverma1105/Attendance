import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import {
  FieldButton,
  MetricCard,
  SectionHeading,
  StatusChip,
  Surface,
  UserEditModal,
  WageEditModal,
  type UserEditFormInput,
} from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import {
  calculateEarnings,
  calculateWorkedDays,
  formatCurrency,
  formatDay,
  useFieldData,
} from "@/lib/field-data";
import { hasPermission } from "@/lib/field-access";
import { canRemoveManagedAccount, isSuperAdmin } from "@/lib/account-lifecycle";
import type { FieldRole, ManagedUser } from "@/lib/field-types";
import { trpc } from "@/lib/trpc";

const roleTitle: Record<FieldRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  employee: "Field Employee",
};

export default function AdminUsersScreen() {
  const router = useRouter();
  const { data, createManagedUser, updateManagedUser, updateEmployeeWage, removeManagedUser } = useFieldData();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | FieldRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "suspended" | "invited">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState("");
  const [initialWage, setInitialWage] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState<string>("");
  const [role, setRole] = useState<FieldRole>("employee");

  // User edit modal state
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);

  const actorRole = data.session?.role;
  const isAdmin = actorRole === "admin";
  const canManage = hasPermission(actorRole, "users.read.all");

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const createUserMutation = trpc.workforce.createUser.useMutation();

  const managers = useMemo(() => {
    return data.managedUsers.filter((u) => u.role === "manager" && u.status === "active");
  }, [data.managedUsers]);

  const visibleUsers = useMemo(() => {
    const seen = new Set<string>();
    return data.managedUsers.filter((user) => {
      const digits = (user.identifier || "").replace(/[^0-9]/g, "");
      const key = digits.length >= 10 ? digits.slice(-10) : user.identifier.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);

      const matchesQuery = `${user.displayName} ${user.identifier} ${user.role} ${
        user.department ?? ""
      }`
        .toLowerCase()
        .includes(query.trim().toLowerCase());
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus = statusFilter === "all" || user.status === statusFilter;
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [data.managedUsers, query, roleFilter, statusFilter]);

  const activeCount = data.managedUsers.filter((u) => u.status === "active").length;
  const suspendedCount = data.managedUsers.filter((u) => u.status === "suspended").length;
  const managersCount = data.managedUsers.filter((u) => u.role === "manager").length;
  const employeesCount = data.managedUsers.filter((u) => u.role === "employee").length;

  const createAccount = async () => {
    if (!name.trim() || !identifier.trim()) {
      Alert.alert(
        "Name and Phone Required",
        "Enter the full name and mobile number before creating the user."
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

    createManagedUser({
      displayName: name.trim(),
      identifier: cleanPhone,
      password: password.trim() || undefined,
      role,
      department: department.trim() || undefined,
      dailyWage: validatedWage,
      managerId: role === "employee" && selectedManagerId ? selectedManagerId : undefined,
    });

    if (isAdmin) {
      await createUserMutation.mutateAsync({
        name: name.trim(),
        phoneE164: cleanPhone,
        role,
        department: department.trim() || undefined,
        dailyWage: validatedWage,
        managerId: role === "employee" && selectedManagerId ? Number(selectedManagerId) : undefined,
      }).catch((err: unknown) => {
        console.warn("[Admin] Server user creation sync queued:", err);
      });
    }

    setName("");
    setIdentifier("");
    setPassword("");
    setDepartment("");
    setInitialWage("");
    setSelectedManagerId("");
    setRole("employee");
    setShowCreate(false);
  };

  const handleStatusToggle = (targetUser: ManagedUser, nextStatus: "active" | "suspended") => {
    if (targetUser.role === "admin" && !isSuperAdmin(data.session?.identifier)) {
      Alert.alert(
        "Permission Denied",
        "Only the Primary Super Administrator (9835916278) can modify or suspend Administrator accounts."
      );
      return;
    }

    if (isSuperAdmin(targetUser.identifier)) {
      Alert.alert(
        "Action Not Allowed",
        "The Primary Super Administrator account cannot be suspended or deactivated."
      );
      return;
    }

    const actionLabel = nextStatus === "suspended" ? "Suspend" : "Reactivate";
    const message = `Are you sure you want to ${actionLabel.toLowerCase()} ${targetUser.displayName}?`;

    if (Platform.OS === "web") {
      const confirmed = typeof window !== "undefined" ? window.confirm(message) : true;
      if (confirmed) {
        updateManagedUser(targetUser.id, { status: nextStatus });
        setEditingUser(null);
      }
      return;
    }

    Alert.alert(`${actionLabel} Account?`, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: actionLabel,
        style: nextStatus === "suspended" ? "destructive" : "default",
        onPress: () => {
          updateManagedUser(targetUser.id, { status: nextStatus });
          setEditingUser(null);
        },
      },
    ]);
  };

  const handleSoftDelete = (targetUser: ManagedUser) => {
    if (targetUser.role === "admin" && !isSuperAdmin(data.session?.identifier)) {
      Alert.alert(
        "Permission Denied",
        "Only the Primary Super Administrator (9835916278) can deactivate or remove Administrator accounts."
      );
      return;
    }

    if (isSuperAdmin(targetUser.identifier)) {
      Alert.alert(
        "Action Not Allowed",
        "The Primary Super Administrator account cannot be deactivated or removed."
      );
      return;
    }

    const message = `Deactivate ${targetUser.displayName}'s account? Historical attendance, GPS, and visit audit trails will be preserved.`;

    if (Platform.OS === "web") {
      const confirmed = typeof window !== "undefined" ? window.confirm(message) : true;
      if (confirmed) {
        removeManagedUser(targetUser.id);
      }
      return;
    }

    Alert.alert("Deactivate Account", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Deactivate",
        style: "destructive",
        onPress: () => removeManagedUser(targetUser.id),
      },
    ]);
  };

  if (!canManage) {
    return (
      <ScreenContainer containerClassName="bg-background" className="flex-1 p-5 justify-center">
        <Surface style={styles.restricted}>
          <MaterialIcons color="#D97706" name="lock" size={36} />
          <Text style={styles.restrictedTitle}>Access Restricted</Text>
          <Text style={styles.restrictedBody}>
            Organization User Management is restricted to Administrators.
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
              <MaterialIcons color="#D97706" name="shield" size={13} />
              <Text style={styles.kicker}>ORGANIZATION DIRECTORY</Text>
            </View>
            <Text style={styles.title}>User Management</Text>
            <Text style={styles.subtitle}>
              {data.managedUsers.length} total registered accounts across all departments
            </Text>
          </View>
          <Pressable
            onPress={() => setShowCreate((prev) => !prev)}
            style={styles.addButton}
          >
            <MaterialIcons color="#92400E" name={showCreate ? "close" : "person-add"} size={20} />
          </Pressable>
        </View>

        {/* Overview Metric Cards */}
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="people"
            label="Active Users"
            tone="success"
            value={activeCount.toString()}
          />
          <MetricCard
            icon="supervisor-account"
            label="Managers"
            tone="amber"
            value={managersCount.toString()}
          />
          <MetricCard
            icon="badge"
            label="Field Workers"
            tone="navy"
            value={employeesCount.toString()}
          />
        </View>

        {/* Create User Form Modal */}
        {showCreate ? (
          <Surface style={styles.formCard}>
            <Text style={styles.formTitle}>Provision New User ID</Text>
            <Text style={styles.formBody}>
              Create a new authenticated account by phone number with instant role assignment.
            </Text>

            <TextInput
              onChangeText={setName}
              placeholder="Full Name (e.g., Rajesh Kumar)"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              value={name}
            />

            <TextInput
              autoCapitalize="none"
              keyboardType="phone-pad"
              onChangeText={setIdentifier}
              placeholder="Mobile Number (e.g., +91 9876543210)"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              value={identifier}
            />

            <TextInput
              autoCapitalize="none"
              onChangeText={setPassword}
              placeholder="Initial Login Password (optional)"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              style={styles.input}
              value={password}
            />

            <TextInput
              onChangeText={setDepartment}
              placeholder="Department / Team (e.g., Solar Field Ops)"
              placeholderTextColor="#94A3B8"
              style={styles.input}
              value={department}
            />

            {/* Role Selection */}
            <Text style={styles.inputLabel}>SELECT ROLE</Text>
            <View style={styles.rolesRow}>
              {(["employee", "manager", "admin"] as FieldRole[]).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={[styles.roleChip, role === r && styles.roleChipActive]}
                >
                  <Text style={[styles.roleText, role === r && styles.roleTextActive]}>
                    {roleTitle[r]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Dynamic Employee-Only Fields */}
            {role === "employee" ? (
              <>
                <View style={styles.wageInputWrap}>
                  <Text style={styles.inputLabel}>DAILY WAGE (₹ / DAY)</Text>
                  <TextInput
                    keyboardType="numeric"
                    onChangeText={setInitialWage}
                    placeholder="e.g., 650"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    value={initialWage}
                  />
                </View>

                {managers.length > 0 ? (
                  <View style={styles.wageInputWrap}>
                    <Text style={styles.inputLabel}>ASSIGN TO MANAGER</Text>
                    <View style={styles.rolesRow}>
                      <Pressable
                        onPress={() => setSelectedManagerId("")}
                        style={[styles.roleChip, !selectedManagerId && styles.roleChipActive]}
                      >
                        <Text style={[styles.roleText, !selectedManagerId && styles.roleTextActive]}>
                          Unassigned
                        </Text>
                      </Pressable>
                      {managers.map((mgr) => (
                        <Pressable
                          key={mgr.id}
                          onPress={() => setSelectedManagerId(mgr.id)}
                          style={[styles.roleChip, selectedManagerId === mgr.id && styles.roleChipActive]}
                        >
                          <Text style={[styles.roleText, selectedManagerId === mgr.id && styles.roleTextActive]}>
                            {mgr.displayName}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            <FieldButton
              icon="person-add"
              label={`Create ${roleTitle[role]} Account`}
              onPress={createAccount}
              style={{ marginTop: 8 }}
            />
          </Surface>
        ) : null}

        {/* Search Bar */}
        <TextInput
          onChangeText={setQuery}
          placeholder="Search by name, phone, department..."
          placeholderTextColor="#94A3B8"
          style={styles.search}
          value={query}
        />

        {/* Role Filters */}
        <View style={styles.filterRow}>
          {(["all", "admin", "manager", "employee"] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRoleFilter(r)}
              style={[styles.filterChip, roleFilter === r && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, roleFilter === r && styles.filterTextActive]}>
                {r === "all" ? "All Roles" : roleTitle[r]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Status Filters */}
        <View style={styles.filterRow}>
          {(["all", "active", "suspended", "invited"] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => setStatusFilter(s)}
              style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>
                {s === "all" ? "All Status" : s.charAt(0).toUpperCase() + s.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* User Directory List */}
        <SectionHeading
          subtitle={`${visibleUsers.length} matching accounts`}
          title="Workforce Directory"
        />

        {visibleUsers.length > 0 ? (
          <View style={styles.directory}>
            {visibleUsers.map((emp) => {
              const manager = data.managedUsers.find((u) => u.id === emp.managerId);
              const userAttendance = data.attendance.filter(
                (rec) => rec.employeeId === emp.id
              );
              const { workedDays } = calculateWorkedDays(userAttendance, currentMonth, currentYear);
              const empEarnings = calculateEarnings(workedDays, emp.dailyWage || 0);

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
                        {manager ? ` · Mgr: ${manager.displayName}` : ""}
                      </Text>
                    </View>
                    <StatusChip
                      label={
                        emp.status === "active"
                          ? "Active"
                          : emp.status === "suspended"
                          ? "Suspended"
                          : "Invited"
                      }
                      tone={
                        emp.status === "active"
                          ? "success"
                          : emp.status === "suspended"
                          ? "danger"
                          : "warning"
                      }
                    />
                  </Pressable>

                  <View style={styles.userDivider} />

                  {/* Financial & Worked-Days Summary Bar for Employees */}
                  {emp.role === "employee" ? (
                    <View style={styles.userFinancialRow}>
                      <View style={styles.wageCol}>
                        <Text style={styles.financialLabel}>DAILY WAGE</Text>
                        <Text style={styles.wageValue}>{formatCurrency(emp.dailyWage)}/day</Text>
                      </View>

                      <View style={styles.wageCol}>
                        <Text style={styles.financialLabel}>WORKED DAYS</Text>
                        <Text style={styles.financialValue}>{workedDays} days</Text>
                      </View>

                      <View style={styles.wageCol}>
                        <Text style={styles.financialLabel}>MONTH EARNINGS</Text>
                        <Text style={styles.earningsValue}>{formatCurrency(empEarnings)}</Text>
                      </View>

                      <Pressable
                        onPress={() => setEditingUser(emp)}
                        style={styles.editWageButton}
                      >
                        <MaterialIcons color="#0F172A" name="edit" size={14} />
                        <Text style={styles.editWageText}>Wage</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.userSalariedRow}>
                      <MaterialIcons color="#D97706" name="shield" size={16} />
                      <Text style={styles.salariedText}>Salaried Management · Excluded from daily wages</Text>
                    </View>
                  )}

                  {/* Action Bar */}
                  <View style={styles.userActionsRow}>
                    <Pressable
                      onPress={() => setEditingUser(emp)}
                      style={[styles.actionButton, styles.editUserBtn]}
                    >
                      <MaterialIcons color="#D97706" name="edit" size={14} />
                      <Text style={[styles.actionText, { color: "#92400E" }]}>Edit</Text>
                    </Pressable>

                    {(emp.role !== "admin" || isSuperAdmin(data.session?.identifier)) && !isSuperAdmin(emp.identifier) && emp.id !== data.session?.id ? (
                      <>
                        <Pressable
                          onPress={() =>
                            handleStatusToggle(
                              emp,
                              emp.status === "suspended" ? "active" : "suspended"
                            )
                          }
                          style={[
                            styles.actionButton,
                            emp.status === "suspended" ? styles.reactivateBtn : styles.suspendBtn,
                          ]}
                        >
                          <MaterialIcons
                            color={emp.status === "suspended" ? "#059669" : "#DC2626"}
                            name={emp.status === "suspended" ? "check-circle" : "block"}
                            size={14}
                          />
                          <Text
                            style={[
                              styles.actionText,
                              { color: emp.status === "suspended" ? "#059669" : "#DC2626" },
                            ]}
                          >
                            {emp.status === "suspended" ? "Reactivate" : "Suspend"}
                          </Text>
                        </Pressable>

                        <Pressable
                          onPress={() => handleSoftDelete(emp)}
                          style={[styles.actionButton, styles.deleteBtn]}
                        >
                          <MaterialIcons color="#64748B" name="delete-outline" size={14} />
                          <Text style={[styles.actionText, { color: "#64748B" }]}>Deactivate</Text>
                        </Pressable>
                      </>
                    ) : null}

                    <Pressable
                      onPress={() =>
                        router.push({ pathname: "/employee-detail", params: { id: emp.id } })
                      }
                      style={styles.detailBtn}
                    >
                      <Text style={styles.detailBtnText}>Full Profile</Text>
                      <MaterialIcons color="#0F172A" name="chevron-right" size={16} />
                    </Pressable>
                  </View>
                </Surface>
              );
            })}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#F59E0B" name="search-off" size={32} />
            <Text style={styles.emptyTitle}>No matching accounts found.</Text>
            <Text style={styles.emptyBody}>
              Try adjusting your role or status filters, or create a new user ID.
            </Text>
          </Surface>
        )}

        {/* Full User Details Edit Modal */}
        {editingUser ? (
          <UserEditModal
            managers={managers.map((m) => ({ id: m.id, displayName: m.displayName }))}
            onClose={() => setEditingUser(null)}
            onSave={(userId, updates) => {
              updateManagedUser(userId, updates);
              setEditingUser(null);
            }}
            user={editingUser}
            visible={Boolean(editingUser)}
          />
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
  addButton: {
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
  formCard: { gap: 10, borderColor: "#FDE68A", backgroundColor: "#FFFDF7", padding: 16 },
  formTitle: { color: "#0F172A", fontSize: 17, fontWeight: "900" },
  formBody: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    color: "#0F172A",
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
    color: "#0F172A",
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
  directory: { gap: 12 },
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
  userName: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
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
  wageCol: { gap: 2 },
  financialLabel: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  wageValue: { color: "#0F172A", fontSize: 13, fontWeight: "800" },
  financialValue: { color: "#0F172A", fontSize: 13, fontWeight: "800" },
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
  editWageText: { color: "#0F172A", fontSize: 11, fontWeight: "800" },
  userActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  suspendBtn: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  reactivateBtn: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  deleteBtn: { backgroundColor: "#F8FAFC", borderColor: "#E2E8F0" },
  editUserBtn: { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" },
  actionText: { fontSize: 11, fontWeight: "800" },
  detailBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: "auto",
    paddingVertical: 6,
  },
  detailBtnText: { color: "#0F172A", fontSize: 12, fontWeight: "800" },
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
