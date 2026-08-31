import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatTime, useFieldData } from "@/lib/field-data";

export default function VisitDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, updateVisit } = useFieldData();
  const visit = data.visits.find((item) => item.id === id);
  const customer = data.customers.find((item) => item.id === visit?.customerId);
  const [outcome, setOutcome] = useState(visit?.meetingOutcome ?? "");
  const [notes, setNotes] = useState(visit?.notes ?? "");
  const [followUpDate, setFollowUpDate] = useState(visit?.followUpDate ?? "");

  useEffect(() => {
    setOutcome(visit?.meetingOutcome ?? "");
    setNotes(visit?.notes ?? "");
    setFollowUpDate(visit?.followUpDate ?? "");
  }, [visit?.followUpDate, visit?.meetingOutcome, visit?.notes]);

  const currentStatus = useMemo(() => {
    if (!visit) return { label: "Unavailable", tone: "danger" as const };
    if (visit.status === "completed") return { label: "Completed", tone: "success" as const };
    if (visit.status === "checked-in") return { label: "At customer", tone: "warning" as const };
    return { label: "Scheduled", tone: "neutral" as const };
  }, [visit]);

  const saveReport = () => {
    if (!visit) return;
    updateVisit(visit.id, { meetingOutcome: outcome.trim() || undefined, notes: notes.trim() || undefined, followUpDate: followUpDate.trim() || undefined });
    Alert.alert("Report saved locally", "Your meeting notes and follow-up details are safely queued for synchronization.");
  };

  const openNavigation = () => {
    if (!customer?.latitude || !customer?.longitude) {
      Alert.alert("Location unavailable", "Add a customer map pin before opening navigation.");
      return;
    }
    const label = encodeURIComponent(customer.name);
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${customer.latitude},${customer.longitude}&destination_place_id=${label}`).catch(() => {
      Alert.alert("Navigation unavailable", "Google Maps could not be opened on this device.");
    });
  };

  if (!visit) {
    return <ScreenContainer containerClassName="bg-background" className="p-5 justify-center"><Surface style={styles.unavailable}><MaterialIcons color="#DD5B67" name="error-outline" size={30} /><Text style={styles.unavailableTitle}>This visit is unavailable.</Text><FieldButton icon="arrow-back" label="Return to visits" onPress={() => router.replace("/(tabs)/visits")} style={{ width: "100%" }} /></Surface></ScreenContainer>;
  }

  const evidenceAction = visit.status === "scheduled" ? "check-in" : "check-out";

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back}><MaterialIcons color="#547087" name="arrow-back" size={22} /></Pressable><View style={{ flex: 1 }}><Text style={styles.kicker}>CUSTOMER VISIT</Text><Text style={styles.title}>{customer?.name ?? "Customer"}</Text><Text style={styles.subtitle}>{customer?.address ?? "Address has not been added"}</Text></View><StatusChip label={currentStatus.label} tone={currentStatus.tone} /></View>
        <Surface style={styles.schedule}><View style={styles.scheduleIcon}><MaterialIcons color="#17354A" name="event" size={21} /></View><View><Text style={styles.scheduleLabel}>SCHEDULED</Text><Text style={styles.scheduleValue}>{formatTime(visit.scheduledFor)}</Text></View><View style={styles.scheduleDivider} /><View><Text style={styles.scheduleLabel}>EVIDENCE</Text><Text style={styles.scheduleValue}>{visit.evidenceUris.length} photo{visit.evidenceUris.length === 1 ? "" : "s"}</Text></View>{customer?.latitude && customer?.longitude ? <Pressable onPress={openNavigation} style={styles.navigationButton}><MaterialIcons color="#0FA99F" name="directions" size={20} /></Pressable> : null}</Surface>
        {visit.status !== "completed" ? <FieldButton icon={evidenceAction === "check-in" ? "where-to-vote" : "how-to-reg"} label={evidenceAction === "check-in" ? "Check in at customer" : "Check out and capture proof"} onPress={() => router.push({ pathname: "/visit-evidence", params: { id: visit.id, action: evidenceAction } })} /> : <Surface style={styles.completeBanner}><MaterialIcons color="#22B573" name="task-alt" size={22} /><View style={{ flex: 1 }}><Text style={styles.completeTitle}>Visit evidence complete</Text><Text style={styles.completeBody}>Complete your meeting report and follow-up details below.</Text></View></Surface>}
        <SectionHeading title="Meeting report" />
        <Surface style={styles.form}><Text style={styles.fieldLabel}>MEETING OUTCOME</Text><TextInput multiline onChangeText={setOutcome} placeholder="What was agreed with the customer?" placeholderTextColor="#7E96A9" style={[styles.input, styles.tallInput]} textAlignVertical="top" value={outcome} /><Text style={styles.fieldLabel}>NOTES AND CUSTOMER FEEDBACK</Text><TextInput multiline onChangeText={setNotes} placeholder="Record important discussion points, feedback, or next actions." placeholderTextColor="#7E96A9" style={[styles.input, styles.tallInput]} textAlignVertical="top" value={notes} /><Text style={styles.fieldLabel}>FOLLOW-UP DATE</Text><TextInput autoCapitalize="none" onChangeText={setFollowUpDate} placeholder="2026-08-25" placeholderTextColor="#7E96A9" style={styles.input} value={followUpDate} /><FieldButton icon="save" label="Save meeting report" onPress={saveReport} variant="secondary" /></Surface>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 18, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EBF0", alignItems: "center", justifyContent: "center" },
  kicker: { color: "#0FA99F", fontSize: 10, letterSpacing: 1.1, fontWeight: "900", marginBottom: 3 },
  title: { color: "#17354A", fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  subtitle: { color: "#7E96A9", fontSize: 11, lineHeight: 16, marginTop: 2 },
  schedule: { flexDirection: "row", alignItems: "center", gap: 11 },
  scheduleIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#DDF8F5", alignItems: "center", justifyContent: "center" },
  scheduleLabel: { color: "#0FA99F", fontSize: 9, letterSpacing: 1, fontWeight: "900" },
  scheduleValue: { color: "#17354A", fontSize: 13, marginTop: 4, fontWeight: "800" },
  scheduleDivider: { width: 1, alignSelf: "stretch", backgroundColor: "#DDEAF0", marginHorizontal: 3 },
  navigationButton: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#F0F7FA", alignItems: "center", justifyContent: "center", marginLeft: "auto" },
  completeBanner: { flexDirection: "row", gap: 11, alignItems: "center", backgroundColor: "#E8F8EF", borderColor: "#C7EBD8" },
  completeTitle: { color: "#198957", fontSize: 14, fontWeight: "800" },
  completeBody: { color: "#4B876B", fontSize: 12, lineHeight: 17, marginTop: 2 },
  form: { gap: 10 },
  fieldLabel: { color: "#0FA99F", fontSize: 10, letterSpacing: 1.1, fontWeight: "900", marginTop: 3 },
  input: { minHeight: 50, borderRadius: 14, backgroundColor: "#F8FBFC", color: "#17354A", borderWidth: 1, borderColor: "#DDEAF0", paddingHorizontal: 13, fontSize: 14 },
  tallInput: { minHeight: 94, paddingTop: 12 },
  unavailable: { alignItems: "center", gap: 13, paddingVertical: 30 },
  unavailableTitle: { color: "#17354A", fontSize: 18, fontWeight: "800" },
});
