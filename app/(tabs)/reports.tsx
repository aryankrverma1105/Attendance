import { ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatDay, useFieldData } from "@/lib/field-data";

export default function ReportsScreen() {
  const { data } = useFieldData();
  const completedVisits = data.visits.filter((visit) => visit.status === "completed");
  const followUps = completedVisits.filter((visit) => visit.followUpDate);

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View><Text style={styles.kicker}>ACTIVITY INTELLIGENCE</Text><Text style={styles.title}>Reports</Text><Text style={styles.subtitle}>Your field evidence, outcomes, and follow-ups.</Text></View>
        <View style={styles.stats}><Surface style={styles.stat}><MaterialIcons color="#22B573" name="task-alt" size={22} /><Text style={styles.statValue}>{completedVisits.length}</Text><Text style={styles.statLabel}>Completed visits</Text></Surface><Surface style={styles.stat}><MaterialIcons color="#D78B1C" name="assignment-late" size={22} /><Text style={styles.statValue}>{followUps.length}</Text><Text style={styles.statLabel}>Follow-ups due</Text></Surface></View>
        <SectionHeading title="Meeting summaries" />
        {completedVisits.length > 0 ? <View style={styles.list}>{completedVisits.map((visit) => { const customer = data.customers.find((item) => item.id === visit.customerId); return <Surface key={visit.id} style={styles.summary}><View style={styles.summaryTop}><View style={{ flex: 1 }}><Text style={styles.summaryName}>{customer?.name ?? "Customer"}</Text><Text style={styles.summaryDate}>{formatDay(visit.checkOutAt ?? visit.scheduledFor)}</Text></View><StatusChip label={`${visit.evidenceUris.length} photo${visit.evidenceUris.length === 1 ? "" : "s"}`} tone="neutral" /></View><Text style={styles.outcome}>{visit.meetingOutcome ?? "Meeting outcome has not been added."}</Text>{visit.notes ? <Text style={styles.notes}>{visit.notes}</Text> : null}{visit.followUpDate ? <View style={styles.followUp}><MaterialIcons color="#D78B1C" name="event-repeat" size={15} /><Text style={styles.followUpText}>Follow-up: {formatDay(visit.followUpDate)}</Text></View> : null}</Surface>; })}</View> : <Surface style={styles.empty}><MaterialIcons color="#159FBE" name="description" size={31} /><Text style={styles.emptyTitle}>Reports grow from completed visits.</Text><Text style={styles.emptyBody}>Finish a customer visit with notes, feedback, photos, and a follow-up date to create a structured activity report.</Text></Surface>}
        <SectionHeading title="Expenses" />
        <Surface style={styles.expense}><View style={styles.expenseIcon}><MaterialIcons color="#17354A" name="receipt-long" size={21} /></View><View style={{ flex: 1 }}><Text style={styles.expenseTitle}>No expenses submitted.</Text><Text style={styles.expenseBody}>Expense capture and policy approval are ready for the Cloud SQL workflow configuration.</Text></View></Surface>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 20, paddingBottom: 32 },
  kicker: { color: "#0FA99F", fontSize: 10, letterSpacing: 1.3, fontWeight: "900", marginBottom: 5 },
  title: { color: "#17354A", fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  subtitle: { color: "#7E96A9", fontSize: 13, marginTop: 4 },
  stats: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, gap: 8, minHeight: 132 },
  statValue: { color: "#17354A", fontSize: 25, fontWeight: "900", marginTop: 5 },
  statLabel: { color: "#7E96A9", fontSize: 12, fontWeight: "600" },
  list: { gap: 10 },
  summary: { gap: 10 },
  summaryTop: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  summaryName: { color: "#17354A", fontSize: 15, fontWeight: "800" },
  summaryDate: { color: "#7E96A9", fontSize: 11, marginTop: 3 },
  outcome: { color: "#547087", fontSize: 13, lineHeight: 18 },
  notes: { color: "#7E96A9", fontSize: 12, lineHeight: 18 },
  followUp: { flexDirection: "row", gap: 6, alignItems: "center" },
  followUpText: { color: "#A96712", fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 36 },
  emptyTitle: { color: "#17354A", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#7E96A9", textAlign: "center", fontSize: 12, lineHeight: 18, maxWidth: 270 },
  expense: { flexDirection: "row", alignItems: "center", gap: 12 },
  expenseIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#FFF2D5", alignItems: "center", justifyContent: "center" },
  expenseTitle: { color: "#17354A", fontSize: 14, fontWeight: "800" },
  expenseBody: { color: "#7E96A9", fontSize: 12, lineHeight: 17, marginTop: 3 },
});
