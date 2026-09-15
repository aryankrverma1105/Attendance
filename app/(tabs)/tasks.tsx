import { useMemo, useState } from "react";
import { FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, MetricCard, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useFieldData } from "@/lib/field-data";
import { canAssignTasks, canUpdateTaskStatus, hasPermission } from "@/lib/field-access";
import { trpc } from "@/lib/trpc";
import type { TaskPriority, TaskStatus } from "@/lib/field-types";

export default function TasksTabScreen() {
  const router = useRouter();
  const { data, createTask, updateTaskStatus } = useFieldData();
  const [modalVisible, setModalVisible] = useState(false);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<"ALL" | TaskStatus>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | TaskPriority>("ALL");

  // Form state for creating a new task
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationLat, setLocationLat] = useState("");
  const [locationLng, setLocationLng] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const currentUser = data.session;
  const isManagerOrAdmin = canAssignTasks(currentUser?.role);
  const isEmployee = currentUser?.role === "employee";

  // Filter available employees for assignment:
  // Admin: all employees
  // Manager: team members with managerId === manager.id
  const assignableEmployees = useMemo(() => {
    return data.managedUsers.filter((u) => {
      if (u.role !== "employee") return false;
      if (currentUser?.role === "admin") return true;
      if (currentUser?.role === "manager") return u.managerId === currentUser.id;
      return false;
    });
  }, [data.managedUsers, currentUser]);

  // Tasks list:
  // If employee: only tasks assigned to self
  // If manager: tasks assigned to team or created by manager
  // If admin: all tasks
  const visibleTasks = useMemo(() => {
    return data.tasks.filter((t) => {
      const matchesStatus = statusFilter === "ALL" || t.status === statusFilter;
      const matchesPriority = priorityFilter === "ALL" || t.priority === priorityFilter;
      if (!matchesStatus || !matchesPriority) return false;

      if (currentUser?.role === "admin") return true;
      if (currentUser?.role === "manager") {
        const target = data.managedUsers.find((u) => u.id === t.assignedToUserId);
        return target?.managerId === currentUser.id || t.assignedByUserId === currentUser.id;
      }
      return t.assignedToUserId === currentUser?.id;
    });
  }, [data.tasks, data.managedUsers, currentUser, statusFilter, priorityFilter]);

  // tRPC mutation for server sync
  const serverCreateTask = trpc.tasks.create.useMutation();
  const serverUpdateStatus = trpc.tasks.updateStatus.useMutation();

  const handleSelectCustomer = (customer: (typeof data.customers)[number]) => {
    setCustomerName(customer.name);
    setLocationAddress(customer.address || "");
    setCustomerContact(customer.phone || "");
    if (customer.latitude && customer.longitude) {
      setLocationLat(customer.latitude.toString());
      setLocationLng(customer.longitude.toString());
    }
  };

  const handleCreateTask = async () => {
    if (!title.trim()) {
      setError("Task title is required.");
      return;
    }
    if (!assignedEmployeeId) {
      setError("Please select an employee to assign this task to.");
      return;
    }

    const assignedUser = data.managedUsers.find((u) => u.id === assignedEmployeeId);
    const todayStr = new Date().toISOString().slice(0, 10);

    try {
      createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        assignedToUserId: assignedEmployeeId,
        assignedToName: assignedUser?.displayName || "Field Worker",
        scheduledDate: todayStr,
        priority,
        locationAddress: locationAddress.trim() || undefined,
        customerName: customerName.trim() || undefined,
      });

      const numericTarget = parseInt(assignedEmployeeId, 10);
      if (!isNaN(numericTarget)) {
        await serverCreateTask.mutateAsync({
          title: title.trim(),
          description: description.trim() || undefined,
          assignedToUserId: numericTarget,
          scheduledDate: todayStr,
          priority,
          locationAddress: locationAddress.trim() || undefined,
          customerName: customerName.trim() || undefined,
        }).catch((err: unknown) => console.warn("[Tasks] Server sync queued:", err));
      }

      setTitle("");
      setDescription("");
      setCustomerName("");
      setCustomerContact("");
      setLocationAddress("");
      setLocationLat("");
      setLocationLng("");
      setPriority("MEDIUM");
      setAssignedEmployeeId("");
      setError(null);
      setModalVisible(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create work order.");
    }
  };

  const handleStatusTransition = async (taskId: string, nextStatus: TaskStatus) => {
    updateTaskStatus(taskId, nextStatus);

    await serverUpdateStatus.mutateAsync({
      taskId: taskId,
      status: nextStatus,
    }).catch((err: unknown) => console.warn("[Tasks] Status update sync queued:", err));
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

  const pendingCount = visibleTasks.filter((t) => t.status === "PENDING").length;
  const inProgressCount = visibleTasks.filter((t) => t.status === "IN_PROGRESS").length;
  const completedCount = visibleTasks.filter((t) => t.status === "COMPLETED").length;

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.kickerRow}>
              <MaterialIcons color="#D97706" name="assignment" size={13} />
              <Text style={styles.kicker}>
                {currentUser?.role === "admin"
                  ? "ORGANIZATION WORK ORDERS"
                  : currentUser?.role === "manager"
                  ? "TEAM WORK ORDERS"
                  : "MY ASSIGNED WORK"}
              </Text>
            </View>
            <Text style={styles.title}>Tasks & Orders</Text>
            <Text style={styles.subtitle}>
              {currentUser?.role === "admin"
                ? `${data.tasks.length} total work orders active across teams`
                : currentUser?.role === "manager"
                ? "Dispatch and track team assignments"
                : "Complete field shifts and customer tasks"}
            </Text>
          </View>
          {isManagerOrAdmin ? (
            <Pressable onPress={() => setModalVisible(true)} style={styles.addButton}>
              <MaterialIcons color="#92400E" name="add" size={24} />
            </Pressable>
          ) : null}
        </View>

        {/* Task Metrics */}
        <View style={styles.metricsGrid}>
          <MetricCard
            icon="pending-actions"
            label="Pending"
            tone="amber"
            value={pendingCount.toString()}
          />
          <MetricCard
            icon="hourglass-top"
            label="In Progress"
            tone="navy"
            value={inProgressCount.toString()}
          />
          <MetricCard
            icon="check-circle"
            label="Completed"
            tone="success"
            value={completedCount.toString()}
          />
        </View>

        {/* Quick Filter Chips */}
        <View style={styles.filterRow}>
          {(["ALL", "PENDING", "IN_PROGRESS", "COMPLETED"] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => setStatusFilter(s)}
              style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>
                {s === "ALL" ? "All Orders" : s.replace("_", " ")}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Task List */}
        <SectionHeading
          action={
            isManagerOrAdmin ? (
              <Pressable
                onPress={() => setModalVisible(true)}
                style={styles.headerActionBtn}
              >
                <MaterialIcons color="#D97706" name="add-task" size={14} />
                <Text style={styles.headerActionText}>Dispatch Task</Text>
              </Pressable>
            ) : null
          }
          subtitle={`${visibleTasks.length} work orders in view`}
          title="Active Work Orders"
        />

        {visibleTasks.length > 0 ? (
          <View style={styles.list}>
            {visibleTasks.map((item) => {
              const canUpdate = canUpdateTaskStatus({
                actorRole: currentUser?.role,
                actorId: currentUser?.id,
                assignedToUserId: item.assignedToUserId,
              });

              return (
                <Surface key={item.id} style={styles.taskCard}>
                  <View style={styles.taskHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.taskTitle}>{item.title}</Text>
                      {item.customerName ? (
                        <Text style={styles.taskCustomer}>Client: {item.customerName}</Text>
                      ) : null}
                    </View>
                    <StatusChip
                      label={item.priority}
                      tone={item.priority === "URGENT" || item.priority === "HIGH" ? "danger" : "solar"}
                    />
                  </View>

                  {item.description ? (
                    <Text style={styles.taskDescription}>{item.description}</Text>
                  ) : null}

                  {item.locationAddress ? (
                    <View style={styles.locationRow}>
                      <MaterialIcons color="#64748B" name="location-on" size={14} />
                      <Text numberOfLines={2} style={styles.locationText}>
                        {item.locationAddress}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.metaRow}>
                    <View style={styles.metaBadge}>
                      <MaterialIcons color="#94A3B8" name="person" size={12} />
                      <Text style={styles.metaText}>
                        {item.assignedToName ? `Worker: ${item.assignedToName}` : "Assigned"}
                      </Text>
                    </View>
                    <View style={styles.metaBadge}>
                      <MaterialIcons color="#94A3B8" name="event" size={12} />
                      <Text style={styles.metaText}>{item.scheduledDate}</Text>
                    </View>
                  </View>

                  <View style={styles.divider} />

                  {/* Actions Row */}
                  <View style={styles.actionsRow}>
                    {/* Directions button if coordinates/address present */}
                    {item.locationAddress || item.locationLat ? (
                      <Pressable
                        onPress={() => openNavigation(item.locationLat, item.locationLng, item.locationAddress)}
                        style={styles.navBtn}
                      >
                        <MaterialIcons color="#2563EB" name="directions" size={15} />
                        <Text style={styles.navBtnText}>Navigate</Text>
                      </Pressable>
                    ) : null}

                    {canUpdate ? (
                      <View style={styles.statusButtons}>
                        {item.status === "PENDING" ? (
                          <Pressable
                            onPress={() => handleStatusTransition(item.id, "IN_PROGRESS")}
                            style={[styles.statusBtn, styles.startBtn]}
                          >
                            <MaterialIcons color="#0F172A" name="play-arrow" size={15} />
                            <Text style={styles.statusBtnText}>Start Shift</Text>
                          </Pressable>
                        ) : null}

                        {item.status === "IN_PROGRESS" ? (
                          <Pressable
                            onPress={() => handleStatusTransition(item.id, "COMPLETED")}
                            style={[styles.statusBtn, styles.completeBtn]}
                          >
                            <MaterialIcons color="#FFFFFF" name="check" size={15} />
                            <Text style={[styles.statusBtnText, { color: "#FFFFFF" }]}>Complete</Text>
                          </Pressable>
                        ) : null}

                        {item.status === "COMPLETED" ? (
                          <View style={styles.completedBadge}>
                            <MaterialIcons color="#059669" name="check-circle" size={15} />
                            <Text style={styles.completedText}>Completed</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <StatusChip
                        label={item.status === "COMPLETED" ? "Finished" : item.status === "IN_PROGRESS" ? "In Progress" : "Pending"}
                        tone={item.status === "COMPLETED" ? "success" : "warning"}
                      />
                    )}
                  </View>
                </Surface>
              );
            })}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#D97706" name="assignment-turned-in" size={32} />
            <Text style={styles.emptyTitle}>No tasks found.</Text>
            <Text style={styles.emptyBody}>
              {isManagerOrAdmin
                ? "Click 'Dispatch Task' above to assign a new work order to your field crew."
                : "You are all caught up! Check back later for new task assignments."}
            </Text>
          </Surface>
        )}

        {/* Task Dispatch Modal */}
        <Modal
          animationType="slide"
          onRequestClose={() => setModalVisible(false)}
          transparent={true}
          visible={modalVisible}
        >
          <View style={styles.modalOverlay}>
            <Surface style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Dispatch Work Order</Text>
                  <Text style={styles.modalSubtitle}>Assign a field task to a worker</Text>
                </View>
                <Pressable onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                  <MaterialIcons color="#64748B" name="close" size={20} />
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: 420 }}>
                {error ? (
                  <View style={styles.errorBanner}>
                    <MaterialIcons color="#DC2626" name="error-outline" size={16} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {/* Quick Customer Picker */}
                {data.customers.length > 0 ? (
                  <View style={styles.formGroup}>
                    <Text style={styles.label}>AUTO-FILL FROM CLIENT</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.customerScroll}>
                      {data.customers.map((c) => (
                        <Pressable
                          key={c.id}
                          onPress={() => handleSelectCustomer(c)}
                          style={[styles.customerChip, customerName === c.name && styles.customerChipActive]}
                        >
                          <Text style={[styles.customerChipText, customerName === c.name && styles.customerChipTextActive]}>
                            {c.name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                <View style={styles.formGroup}>
                  <Text style={styles.label}>TASK TITLE *</Text>
                  <TextInput
                    onChangeText={setTitle}
                    placeholder="e.g. Solar Panel Inspection & Maintenance"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    value={title}
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>ASSIGN FIELD WORKER *</Text>
                  <View style={styles.workerSelectGrid}>
                    {assignableEmployees.map((emp) => (
                      <Pressable
                        key={emp.id}
                        onPress={() => setAssignedEmployeeId(emp.id)}
                        style={[styles.workerChip, assignedEmployeeId === emp.id && styles.workerChipActive]}
                      >
                        <Text style={[styles.workerChipText, assignedEmployeeId === emp.id && styles.workerChipTextActive]}>
                          {emp.displayName}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>PRIORITY</Text>
                  <View style={styles.priorityRow}>
                    {(["LOW", "MEDIUM", "HIGH", "URGENT"] as TaskPriority[]).map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => setPriority(p)}
                        style={[styles.priorityChip, priority === p && styles.priorityChipActive]}
                      >
                        <Text style={[styles.priorityChipText, priority === p && styles.priorityChipTextActive]}>
                          {p}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>CLIENT NAME</Text>
                  <TextInput
                    onChangeText={setCustomerName}
                    placeholder="e.g. GreenPower Plant Ranchi"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    value={customerName}
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>SITE ADDRESS</Text>
                  <TextInput
                    onChangeText={setLocationAddress}
                    placeholder="e.g. Sector 4, Industrial Area, Ranchi"
                    placeholderTextColor="#94A3B8"
                    style={styles.input}
                    value={locationAddress}
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>INSTRUCTIONS / NOTES</Text>
                  <TextInput
                    multiline
                    numberOfLines={3}
                    onChangeText={setDescription}
                    placeholder="Provide specific directions, safety requirements, or checklist..."
                    placeholderTextColor="#94A3B8"
                    style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
                    value={description}
                  />
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <Pressable onPress={() => setModalVisible(false)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleCreateTask} style={styles.submitBtn}>
                  <Text style={styles.submitBtnText}>Dispatch Task</Text>
                </Pressable>
              </View>
            </Surface>
          </View>
        </Modal>
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
  headerActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  headerActionText: { color: "#92400E", fontSize: 12, fontWeight: "800" },
  list: { gap: 12 },
  taskCard: { padding: 16, gap: 10 },
  taskHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  taskTitle: { color: "#0F172A", fontSize: 15, fontWeight: "900" },
  taskCustomer: { color: "#D97706", fontSize: 12, fontWeight: "800", marginTop: 2 },
  taskDescription: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  locationText: { color: "#64748B", fontSize: 11, flex: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  metaBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: "#94A3B8", fontSize: 11, fontWeight: "600" },
  divider: { height: 1, backgroundColor: "#F1F5F9" },
  actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
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
  statusButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  startBtn: { backgroundColor: "#FEF3C7" },
  completeBtn: { backgroundColor: "#059669" },
  statusBtnText: { color: "#0F172A", fontSize: 11, fontWeight: "800" },
  completedBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  completedText: { color: "#059669", fontSize: 12, fontWeight: "800" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 28 },
  emptyTitle: { color: "#0F172A", fontSize: 15, fontWeight: "800" },
  emptyBody: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 270,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    justifyContent: "center",
    padding: 18,
  },
  modalContent: { padding: 20, gap: 14, maxHeight: "90%", borderRadius: 24 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  modalSubtitle: { color: "#64748B", fontSize: 12 },
  closeBtn: { padding: 4 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  errorText: { color: "#DC2626", fontSize: 12, fontWeight: "700" },
  formGroup: { gap: 6, marginBottom: 10 },
  label: { color: "#D97706", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  customerScroll: { flexDirection: "row", gap: 6 },
  customerChip: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 6,
  },
  customerChipActive: { borderColor: "#D97706", backgroundColor: "#FEF3C7" },
  customerChipText: { color: "#64748B", fontSize: 11, fontWeight: "700" },
  customerChipTextActive: { color: "#92400E", fontWeight: "900" },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    color: "#0F172A",
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  workerSelectGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  workerChip: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  workerChipActive: { borderColor: "#D97706", backgroundColor: "#FEF3C7" },
  workerChipText: { color: "#64748B", fontSize: 11, fontWeight: "700" },
  workerChipTextActive: { color: "#92400E", fontWeight: "900" },
  priorityRow: { flexDirection: "row", gap: 6 },
  priorityChip: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
    borderRadius: 10,
  },
  priorityChipActive: { borderColor: "#D97706", backgroundColor: "#FEF3C7" },
  priorityChipText: { color: "#64748B", fontSize: 11, fontWeight: "700" },
  priorityChipTextActive: { color: "#92400E", fontWeight: "900" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelBtnText: { color: "#64748B", fontSize: 13, fontWeight: "800" },
  submitBtn: {
    flex: 2,
    backgroundColor: "#D97706",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  submitBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
});
