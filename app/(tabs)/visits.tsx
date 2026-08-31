import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatDay, formatTime, getDayKey, useFieldData } from "@/lib/field-data";

export default function VisitsScreen() {
  const router = useRouter();
  const { data } = useFieldData();
  const todaysVisits = data.visits.filter((visit) => getDayKey(visit.scheduledFor) === getDayKey(new Date()));
  const upcomingVisits = data.visits.filter((visit) => getDayKey(visit.scheduledFor) !== getDayKey(new Date()));

  const visitCard = (visit: (typeof data.visits)[number]) => {
    const customer = data.customers.find((item) => item.id === visit.customerId);
    const status = visit.status === "completed" ? "Completed" : visit.status === "checked-in" ? "At customer" : "Scheduled";
    const tone = visit.status === "completed" ? "success" : visit.status === "checked-in" ? "warning" : "neutral";
    return (
      <Pressable key={visit.id} onPress={() => router.push({ pathname: "/visit-detail", params: { id: visit.id } })} style={({ pressed }) => [styles.visitPressable, pressed && styles.pressed]}>
        <Surface style={styles.visitCard}>
          <View style={styles.timeColumn}><Text style={styles.time}>{formatTime(visit.scheduledFor)}</Text><View style={styles.line} /></View>
          <View style={styles.visitCopy}><View style={styles.visitTop}><View style={{ flex: 1 }}><Text style={styles.visitName}>{customer?.name ?? "Customer is awaiting sync"}</Text><Text style={styles.visitAddress}>{customer?.address ?? "Address pending"}</Text></View><StatusChip label={status} tone={tone} /></View><Text style={styles.visitDetails}>{visit.meetingOutcome ? `Outcome: ${visit.meetingOutcome}` : visit.status === "scheduled" ? "Open to check in with photo and GPS proof." : "Finish the report, follow-up, and evidence capture."}</Text></View>
        </Surface>
      </Pressable>
    );
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}><View><Text style={styles.kicker}>FIELD ITINERARY</Text><Text style={styles.title}>Visits</Text><Text style={styles.subtitle}>Every customer interaction with evidence.</Text></View><Pressable onPress={() => router.push("/visit-plan")} style={styles.addButton}><MaterialIcons color="#17354A" name="add" size={24} /></Pressable></View>
        <FieldButton icon="add-location-alt" label="Plan a customer visit" onPress={() => router.push("/visit-plan")} />
        <SectionHeading title="Today" />
        {todaysVisits.length > 0 ? <View style={styles.list}>{todaysVisits.map(visitCard)}</View> : <Surface style={styles.empty}><MaterialIcons color="#159FBE" name="event-available" size={30} /><Text style={styles.emptyTitle}>No visits planned for today.</Text><Text style={styles.emptyBody}>Create a visit after choosing a customer to keep your field itinerary accountable.</Text></Surface>}
        {upcomingVisits.length > 0 ? <><SectionHeading title="Upcoming" /><View style={styles.list}>{upcomingVisits.map(visitCard)}</View></> : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 32, gap: 18 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kicker: { color: "#0FA99F", fontSize: 10, letterSpacing: 1.4, fontWeight: "900", marginBottom: 5 },
  title: { color: "#17354A", fontWeight: "900", fontSize: 28, letterSpacing: -0.6 },
  subtitle: { color: "#7E96A9", marginTop: 4, fontSize: 13 },
  addButton: { width: 46, height: 46, borderRadius: 16, backgroundColor: "#DDF8F5", borderWidth: 1, borderColor: "#C6ECE8", alignItems: "center", justifyContent: "center" },
  list: { gap: 10 },
  visitPressable: { borderRadius: 22 },
  visitCard: { flexDirection: "row", gap: 12, padding: 14 },
  timeColumn: { width: 53, alignItems: "center", gap: 7 },
  time: { color: "#547087", fontSize: 11, fontWeight: "800" },
  line: { flex: 1, width: 1, backgroundColor: "#DDEAF0" },
  visitCopy: { flex: 1, gap: 8 },
  visitTop: { flexDirection: "row", gap: 9, alignItems: "flex-start" },
  visitName: { color: "#17354A", fontSize: 15, fontWeight: "800" },
  visitAddress: { color: "#7E96A9", fontSize: 12, lineHeight: 17, marginTop: 3 },
  visitDetails: { color: "#547087", fontSize: 12, lineHeight: 17 },
  empty: { alignItems: "center", paddingVertical: 34, gap: 9 },
  emptyTitle: { color: "#17354A", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#7E96A9", fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 260 },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.88 },
});
