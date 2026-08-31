import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useFieldData } from "@/lib/field-data";
import { canAssignTasks, canUpdateTaskStatus } from "@/lib/field-access";
import { trpc } from "@/lib/trpc";
import type { TaskPriority, TaskStatus } from "@/lib/field-types";

export default function TasksScreen() {
  const router = useRouter();
  const { data, createTask, updateTaskStatus } = useFieldData();
  const [modalVisible, setModalVisible] = useState(false);

  // Form state for creating a new task
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const currentUser = data.session;
  const isManagerOrAdmin = canAssignTasks(currentUser?.role);

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
      if (currentUser?.role === "admin") return true;
      if (currentUser?.role === "manager") {
        const target = data.managedUsers.find((u) => u.id === t.assignedToUserId);
        return target?.managerId === currentUser.id || t.assignedByUserId === currentUser.id;
      }
      return t.assignedToUserId === currentUser?.id;
    });
  }, [data.tasks, data.managedUsers, currentUser]);

  // tRPC mutation for server sync
  const serverCreateTask = trpc.tasks.create.useMutation();
  const serverUpdateStatus = trpc.tasks.updateStatus.useMutation();

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
      // 1. Create in local workspace
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

      // 2. Sync to server if target has numeric ID
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
        }).catch((err) => console.warn("[Tasks] Server sync queued:", err));
      }

      // Reset modal
      setTitle("");
      setDescription("");
      setCustomerName("");
      setLocationAddress("");
      setAssignedEmployeeId("");
      setError(null);
      setModalVisible(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    }
  };

  const handleStatusTransition = async (taskId: string, currentStatus: TaskStatus) => {
    const nextStatus: TaskStatus =
      currentStatus === "PENDING"
        ? "IN_PROGRESS"
        : currentStatus === "IN_PROGRESS"
        ? "COMPLETED"
        : "COMPLETED";

    // 1. Local update
    updateTaskStatus(taskId, nextStatus);

    // 2. Server update
    await serverUpdateStatus.mutateAsync({
      taskId,
      status: nextStatus,
    }).catch((err) => console.warn("[Tasks] Server status sync queued:", err));
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      {/* Sunlight Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons color="#0F172A" name="arrow-back" size={20} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={styles.kickerRow}>
            <MaterialIcons color="#D97706" name="assignment" size={14} />
            <Text style={styles.kicker}>FIELD WORK ORDERS</Text>
          </View>
          <Text style={styles.title}>Tasks & Assignments</Text>
          <Text style={styles.subtitle}>
            {isManagerOrAdmin ? "Assign and supervise field work orders" : "Your assigned daily work orders"}
          </Text>
        </View>
        {isManagerOrAdmin ? (
          <Pressable onPress={() => setModalVisible(true)} style={styles.assignButton}>
            <MaterialIcons color="#0F172A" name="add" size={22} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Management Overview Card */}
        {isManagerOrAdmin ? (
          <Surface style={styles.bannerSurface}>
            <View style={styles.bannerIcon}>
              <MaterialIcons color="#D97706" name="add-task" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Work Order Dispatch</Text>
              <Text style={styles.bannerSubtitle}>
                Assign solar inspection, maintenance, or client visit tasks to your field team.
              </Text>
            </View>
            <FieldButton
              icon="add"
              label="Assign"
              onPress={() => setModalVisible(true)}
              variant="primary"
            />
          </Surface>
        ) : null}

        {/* Tasks List */}
        <SectionHeading
          subtitle={`${visibleTasks.length} total tasks scheduled`}
          title={isManagerOrAdmin ? "All Team Tasks" : "My Assigned Tasks"}
        />

        {visibleTasks.length === 0 ? (
          <Surface style={styles.emptyCard}>
            <MaterialIcons color="#D97706" name="check-circle-outline" size={36} />
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyBody}>
              {isManagerOrAdmin
                ? "No tasks currently assigned. Tap 'Assign' above to dispatch a work order."
                : "You have no pending tasks assigned for today."}
            </Text>
          </Surface>
        ) : (
          visibleTasks.map((task) => {
            const canUpdate = canUpdateTaskStatus({
              actorRole: currentUser?.role,
              actorId: currentUser?.id,
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
                    <Text style={styles.taskTitle}>{task.title}</Text>
                  </View>
                </View>

                {task.description ? (
                  <Text style={styles.taskDescription}>{task.description}</Text>
                ) : null}

                <View style={styles.taskMetaGrid}>
                  {task.customerName ? (
                    <View style={styles.metaItem}>
                      <MaterialIcons color="#D97706" name="storefront" size={14} />
                      <Text style={styles.metaText}>{task.customerName}</Text>
                    </View>
                  ) : null}
                  {task.locationAddress ? (
                    <View style={styles.metaItem}>
                      <MaterialIcons color="#64748B" name="place" size={14} />
                      <Text style={styles.metaText}>{task.locationAddress}</Text>
                    </View>
                  ) : null}
                  <View style={styles.metaItem}>
                    <MaterialIcons color="#64748B" name="person" size={14} />
                    <Text style={styles.metaText}>
                      Assigned to: {task.assignedToName || `Worker #${task.assignedToUserId}`}
                    </Text>
                  </View>
                </View>

                {canUpdate && task.status !== "COMPLETED" ? (
                  <View style={styles.taskActions}>
                    {task.status === "PENDING" ? (
                      <FieldButton
                        icon="play-arrow"
                        label="Start Task"
                        onPress={() => handleStatusTransition(task.id, "PENDING")}
                        style={{ flex: 1 }}
                        variant="primary"
                      />
                    ) : (
                      <FieldButton
                        icon="check-circle"
                        label="Mark Completed"
                        onPress={() => handleStatusTransition(task.id, "IN_PROGRESS")}
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
      </ScrollView>

      {/* Task Creation Modal */}
      <Modal animationType="slide" transparent visible={modalVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <MaterialIcons color="#D97706" name="add-task" size={22} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assign New Task</Text>
                <Text style={styles.modalSubtitle}>Dispatch work order to field engineer</Text>
              </View>
              <Pressable onPress={() => setModalVisible(false)} style={styles.modalClose}>
                <MaterialIcons color="#64748B" name="close" size={20} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }}>
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>TASK TITLE *</Text>
                <TextInput
                  onChangeText={(t) => { setTitle(t); setError(null); }}
                  placeholder="e.g. Solar Inverter Inspection"
                  placeholderTextColor="#94A3B8"
                  style={styles.input}
                  value={title}
                />

                <Text style={styles.inputLabel}>ASSIGN TO EMPLOYEE *</Text>
                <View style={styles.employeeSelector}>
                  {assignableEmployees.map((emp) => {
                    const isSelected = assignedEmployeeId === emp.id;
                    return (
                      <Pressable
                        key={emp.id}
                        onPress={() => { setAssignedEmployeeId(emp.id); setError(null); }}
                        style={[styles.empPill, isSelected && styles.empPillSelected]}
                      >
                        <MaterialIcons
                          color={isSelected ? "#D97706" : "#64748B"}
                          name="person"
                          size={14}
                        />
                        <Text style={[styles.empPillText, isSelected && styles.empPillTextSelected]}>
                          {emp.displayName}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {assignableEmployees.length === 0 ? (
                    <Text style={styles.emptyEmpText}>No eligible employees found in your team.</Text>
                  ) : null}
                </View>

                <Text style={styles.inputLabel}>PRIORITY</Text>
                <View style={styles.priorityRow}>
                  {(["LOW", "MEDIUM", "HIGH", "URGENT"] as TaskPriority[]).map((p) => {
                    const isSelected = priority === p;
                    return (
                      <Pressable
                        key={p}
                        onPress={() => setPriority(p)}
                        style={[styles.priorityPill, isSelected && styles.priorityPillSelected]}
                      >
                        <Text style={[styles.priorityPillText, isSelected && styles.priorityPillTextSelected]}>
                          {p}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.inputLabel}>CUSTOMER / SITE NAME</Text>
                <TextInput
                  onChangeText={setCustomerName}
                  placeholder="e.g. Sharma Rooftop Installation"
                  placeholderTextColor="#94A3B8"
                  style={styles.input}
                  value={customerName}
                />

                <Text style={styles.inputLabel}>SITE ADDRESS</Text>
                <TextInput
                  onChangeText={setLocationAddress}
                  placeholder="e.g. Sector 62, Noida"
                  placeholderTextColor="#94A3B8"
                  style={styles.input}
                  value={locationAddress}
                />

                <Text style={styles.inputLabel}>DESCRIPTION / INSTRUCTIONS</Text>
                <TextInput
                  multiline
                  numberOfLines={3}
                  onChangeText={setDescription}
                  placeholder="Details, safety guidelines, contact person..."
                  placeholderTextColor="#94A3B8"
                  style={[styles.input, { minHeight: 64, textAlignVertical: "top" }]}
                  value={description}
                />

                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <FieldButton
                label="Cancel"
                onPress={() => setModalVisible(false)}
                style={{ flex: 1 }}
                variant="secondary"
              />
              <FieldButton
                icon="check"
                label="Assign Task"
                onPress={handleCreateTask}
                style={{ flex: 1 }}
                variant="primary"
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  assignButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    alignItems: "center",
    justifyContent: "center",
  },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  kicker: { color: "#D97706", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "#0F172A", fontSize: 20, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: "#334155", fontSize: 12, marginTop: 1 },
  content: { padding: 16, gap: 14 },
  bannerSurface: {
    padding: 14,
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerTitle: { color: "#0F172A", fontSize: 14, fontWeight: "900" },
  bannerSubtitle: { color: "#475569", fontSize: 11, marginTop: 2 },
  taskCard: { padding: 16, gap: 10, backgroundColor: "#FFFFFF", borderColor: "#E2E8F0" },
  taskHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  badgeRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
  taskTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  taskDescription: { color: "#475569", fontSize: 13, lineHeight: 18 },
  taskMetaGrid: { gap: 4, marginTop: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: "#334155", fontSize: 12, fontWeight: "600" },
  taskActions: { marginTop: 6, flexDirection: "row", gap: 8 },
  emptyCard: { padding: 24, alignItems: "center", textAlign: "center", gap: 8 },
  emptyTitle: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  emptyBody: { color: "#64748B", fontSize: 12, textAlign: "center", lineHeight: 18 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContainer: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    gap: 14,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: { color: "#0F172A", fontSize: 17, fontWeight: "900" },
  modalSubtitle: { color: "#64748B", fontSize: 12, marginTop: 1 },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  formGroup: { gap: 10 },
  inputLabel: { color: "#D97706", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  input: {
    minHeight: 44,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "700",
  },
  employeeSelector: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  empPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  empPillSelected: { backgroundColor: "#FEF3C7", borderColor: "#D97706" },
  empPillText: { color: "#334155", fontSize: 12, fontWeight: "700" },
  empPillTextSelected: { color: "#D97706", fontWeight: "900" },
  emptyEmpText: { color: "#64748B", fontSize: 12, fontStyle: "italic" },
  priorityRow: { flexDirection: "row", gap: 6 },
  priorityPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
  },
  priorityPillSelected: { backgroundColor: "#FEF3C7", borderColor: "#D97706" },
  priorityPillText: { color: "#334155", fontSize: 11, fontWeight: "800" },
  priorityPillTextSelected: { color: "#D97706", fontWeight: "900" },
  errorText: { color: "#DC2626", fontSize: 12, fontWeight: "700" },
  modalFooter: { flexDirection: "row", gap: 10, marginTop: 4 },
});
