import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, MetricCard, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { AuthImage } from "@/components/auth-image";
import { formatDay, formatTime, useFieldData } from "@/lib/field-data";
import { trpc } from "@/lib/trpc";

export default function AttendanceReviewScreen() {
  const router = useRouter();
  const { data } = useFieldData();
  const [filter, setFilter] = useState<"review" | "all">("review");
  const [reviewModalRecord, setReviewModalRecord] = useState<any | null>(null);
  const [reviewDecision, setReviewDecision] = useState<"approved" | "rejected">("approved");
  const [reviewNotes, setReviewNotes] = useState("");

  const actorRole = data.session?.role;
  const isAuthorized = actorRole === "admin" || actorRole === "manager";

  const teamAttendanceQuery = trpc.attendance.getTeamAttendance.useQuery(undefined, {
    enabled: isAuthorized,
    refetchInterval: 10000,
  });

  const reviewMutation = trpc.attendance.reviewRecord.useMutation();

  const records = useMemo(() => {
    const list = teamAttendanceQuery.data && Array.isArray(teamAttendanceQuery.data) ? teamAttendanceQuery.data : [];
    if (filter === "review") {
      return list.filter((r) => r.status === "review");
    }
    return list;
  }, [teamAttendanceQuery.data, filter]);

  const reviewCount = useMemo(() => {
    const list = teamAttendanceQuery.data && Array.isArray(teamAttendanceQuery.data) ? teamAttendanceQuery.data : [];
    return list.filter((r) => r.status === "review").length;
  }, [teamAttendanceQuery.data]);

  const handleReviewSubmit = async () => {
    if (!reviewModalRecord) return;
    try {
      await reviewMutation.mutateAsync({
        recordId: reviewModalRecord.id,
        decision: reviewDecision,
        notes: reviewNotes.trim() || undefined,
      });
      await teamAttendanceQuery.refetch();
      setReviewModalRecord(null);
      setReviewNotes("");
      Alert.alert("Decision Saved", `Attendance record ${reviewDecision === "approved" ? "approved" : "rejected"} successfully.`);
    } catch (err: any) {
      Alert.alert("Review Failed", err?.message || "Could not save review decision on server.");
    }
  };

  if (!isAuthorized) {
    return (
      <ScreenContainer containerClassName="bg-background" className="flex-1 p-5 justify-center">
        <Surface style={styles.restricted}>
          <MaterialIcons color="#D97706" name="lock" size={36} />
          <Text style={styles.restrictedTitle}>Access Restricted</Text>
          <Text style={styles.restrictedBody}>
            Attendance verification review is restricted to Field Managers and Administrators.
          </Text>
        </Surface>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <MaterialIcons color="#0B192C" name="arrow-back" size={22} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={styles.kickerRow}>
              <MaterialIcons color="#D97706" name="verified-user" size={14} />
              <Text style={styles.kicker}>AUDIT & VERIFICATION</Text>
            </View>
            <Text style={styles.title}>Review Attendance</Text>
            <Text style={styles.subtitle}>
              Approve or reject flagged check-ins outside assigned geofence boundaries
            </Text>
          </View>
        </View>

        <View style={styles.metricsGrid}>
          <MetricCard
            icon="warning"
            label="Pending Review"
            tone="amber"
            value={reviewCount.toString()}
          />
          <MetricCard
            icon="event-available"
            label="Total Shift Logs"
            tone="navy"
            value={(teamAttendanceQuery.data?.length ?? 0).toString()}
          />
        </View>

        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setFilter("review")}
            style={[styles.filterChip, filter === "review" && styles.filterChipActive]}
          >
            <Text style={[styles.filterText, filter === "review" && styles.filterTextActive]}>
              Flagged for Review ({reviewCount})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter("all")}
            style={[styles.filterChip, filter === "all" && styles.filterChipActive]}
          >
            <Text style={[styles.filterText, filter === "all" && styles.filterTextActive]}>
              All Shift Records
            </Text>
          </Pressable>
        </View>

        <SectionHeading
          subtitle={`${records.length} records matching current filter`}
          title={filter === "review" ? "Flagged Check-Ins" : "All Team Shift Logs"}
        />

        {records.length > 0 ? (
          <View style={styles.list}>
            {records.map((rec) => (
              <Surface key={rec.id} style={styles.recordCard}>
                <View style={styles.recordTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.employeeName}>{rec.userName || `Worker #${rec.userId}`}</Text>
                    <Text style={styles.employeeMeta}>{rec.userPhone || ""} {rec.userDepartment ? `· ${rec.userDepartment}` : ""}</Text>
                    <Text style={styles.timeMeta}>
                      {formatDay(rec.checkInAt)} · {formatTime(rec.checkInAt)}
                      {rec.checkOutAt ? ` → ${formatTime(rec.checkOutAt)}` : " (Active)"}
                    </Text>
                  </View>
                  <StatusChip
                    label={
                      rec.status === "verified"
                        ? "Approved"
                        : rec.status === "rejected"
                        ? "Rejected"
                        : "Review Needed"
                    }
                    tone={
                      rec.status === "verified"
                        ? "success"
                        : rec.status === "rejected"
                        ? "danger"
                        : "warning"
                    }
                  />
                </View>

                <View style={styles.evidenceRow}>
                  {rec.checkInPhotoUri ? (
                    <View style={styles.photoThumbWrap}>
                      <AuthImage source={{ uri: rec.checkInPhotoUri }} style={styles.photoThumb} />
                    </View>
                  ) : (
                    <View style={styles.photoFallback}>
                      <MaterialIcons color="#94A3B8" name="no-photography" size={24} />
                    </View>
                  )}

                  <View style={styles.evidenceDetails}>
                    <Text style={styles.detailLabel}>GEOFENCE AUDIT</Text>
                    <Text style={styles.detailValue}>
                      Status: <Text style={{ fontWeight: "800", color: rec.geofenceStatus === "inside" ? "#059669" : "#D97706" }}>
                        {rec.geofenceStatus || "unverified"}
                      </Text>
                    </Text>
                    {rec.distanceMeters !== null && rec.distanceMeters !== undefined ? (
                      <Text style={styles.detailValue}>
                        Distance to site: {Math.round(rec.distanceMeters)} meters
                      </Text>
                    ) : null}
                    {rec.checkInLat && rec.checkInLng ? (
                      <Text style={styles.detailCoords}>
                        GPS: {parseFloat(rec.checkInLat).toFixed(5)}, {parseFloat(rec.checkInLng).toFixed(5)}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {rec.status === "review" ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => {
                        setReviewModalRecord(rec);
                        setReviewDecision("approved");
                      }}
                      style={[styles.btn, styles.approveBtn]}
                    >
                      <MaterialIcons color="#059669" name="check-circle" size={16} />
                      <Text style={styles.approveBtnText}>Approve</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setReviewModalRecord(rec);
                        setReviewDecision("rejected");
                      }}
                      style={[styles.btn, styles.rejectBtn]}
                    >
                      <MaterialIcons color="#DC2626" name="cancel" size={16} />
                      <Text style={styles.rejectBtnText}>Reject</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.reviewedInfo}>
                    <Text style={styles.reviewedText}>
                      {rec.status === "verified" ? "✓ Verified for payroll" : "✕ Rejected from payroll"}
                      {rec.reviewNotes ? ` — ${rec.reviewNotes}` : ""}
                    </Text>
                  </View>
                )}
              </Surface>
            ))}
          </View>
        ) : (
          <Surface style={styles.empty}>
            <MaterialIcons color="#059669" name="check-circle-outline" size={36} />
            <Text style={styles.emptyTitle}>No records requiring review</Text>
            <Text style={styles.emptyBody}>
              All field attendance check-ins are verified and approved within allowed geofences.
            </Text>
          </Surface>
        )}

        {/* Review Decision Modal */}
        <Modal
          animationType="fade"
          onRequestClose={() => setReviewModalRecord(null)}
          transparent
          visible={Boolean(reviewModalRecord)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {reviewDecision === "approved" ? "Approve Attendance" : "Reject Attendance"}
              </Text>
              <Text style={styles.modalBody}>
                {reviewDecision === "approved"
                  ? `Approve ${reviewModalRecord?.userName || "worker"}'s shift for daily wage and payroll computation.`
                  : `Reject ${reviewModalRecord?.userName || "worker"}'s shift. This will exclude it from daily wage payroll computation.`}
              </Text>

              <TextInput
                onChangeText={setReviewNotes}
                placeholder="Optional audit notes or justification..."
                placeholderTextColor="#94A3B8"
                style={styles.notesInput}
                value={reviewNotes}
                multiline
              />

              <View style={styles.modalActionRow}>
                <Pressable
                  onPress={() => setReviewModalRecord(null)}
                  style={styles.cancelBtn}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <FieldButton
                  icon={reviewDecision === "approved" ? "check" : "close"}
                  label={reviewDecision === "approved" ? "Confirm Approval" : "Confirm Rejection"}
                  loading={reviewMutation.isPending}
                  onPress={handleReviewSubmit}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    justifyContent: "center",
    alignItems: "center",
  },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 },
  kicker: { color: "#D97706", fontSize: 10, letterSpacing: 1.2, fontWeight: "900" },
  title: { color: "#0F172A", fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: "#64748B", fontSize: 12, marginTop: 2 },
  metricsGrid: { flexDirection: "row", gap: 10 },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  filterChipActive: { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" },
  filterText: { color: "#64748B", fontSize: 12, fontWeight: "700" },
  filterTextActive: { color: "#92400E", fontWeight: "900" },
  list: { gap: 12 },
  recordCard: { padding: 14, gap: 10 },
  recordTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  employeeName: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  employeeMeta: { color: "#64748B", fontSize: 11, marginTop: 1 },
  timeMeta: { color: "#334155", fontSize: 12, fontWeight: "600", marginTop: 3 },
  evidenceRow: { flexDirection: "row", gap: 12, backgroundColor: "#F8FAFC", padding: 10, borderRadius: 12 },
  photoThumbWrap: { width: 68, height: 68, borderRadius: 12, overflow: "hidden", backgroundColor: "#E2E8F0" },
  photoThumb: { width: "100%", height: "100%" },
  photoFallback: { width: 68, height: 68, borderRadius: 12, backgroundColor: "#E2E8F0", justifyContent: "center", alignItems: "center" },
  evidenceDetails: { flex: 1, gap: 3 },
  detailLabel: { color: "#94A3B8", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  detailValue: { color: "#334155", fontSize: 12, fontWeight: "600" },
  detailCoords: { color: "#64748B", fontSize: 11 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  approveBtn: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  approveBtnText: { color: "#059669", fontSize: 12, fontWeight: "800" },
  rejectBtn: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  rejectBtnText: { color: "#DC2626", fontSize: 12, fontWeight: "800" },
  reviewedInfo: { backgroundColor: "#F1F5F9", padding: 8, borderRadius: 8 },
  reviewedText: { color: "#475569", fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 36, gap: 10 },
  emptyTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#64748B", fontSize: 12, textAlign: "center", maxWidth: 280, lineHeight: 18 },
  restricted: { alignItems: "center", gap: 12, paddingVertical: 36, paddingHorizontal: 20 },
  restrictedTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  restrictedBody: { color: "#64748B", textAlign: "center", fontSize: 13, lineHeight: 19 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.65)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 380, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 20, gap: 12 },
  modalTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  modalBody: { color: "#64748B", fontSize: 13, lineHeight: 18 },
  notesInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    padding: 12,
    minHeight: 70,
    fontSize: 13,
    color: "#0F172A",
    textAlignVertical: "top",
  },
  modalActionRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { paddingHorizontal: 14, justifyContent: "center", alignItems: "center" },
  cancelBtnText: { color: "#64748B", fontWeight: "700", fontSize: 13 },
});
