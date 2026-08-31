import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useFieldData } from "@/lib/field-data";

export default function VisitPlanScreen() {
  const router = useRouter();
  const { data, createVisit } = useFieldData();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(data.customers[0]?.id ?? null);
  const [dateText, setDateText] = useState(new Date().toISOString().slice(0, 16));
  const selectedCustomer = useMemo(() => data.customers.find((customer) => customer.id === selectedCustomerId), [data.customers, selectedCustomerId]);

  const planVisit = () => {
    if (!selectedCustomerId) {
      Alert.alert("Choose a customer", "Add or select a customer before creating a visit.");
      return;
    }
    const parsedDate = new Date(dateText);
    if (Number.isNaN(parsedDate.getTime())) {
      Alert.alert("Date format needed", "Use a valid ISO date such as 2026-08-21T14:30.");
      return;
    }
    const id = createVisit({ customerId: selectedCustomerId, scheduledFor: parsedDate.toISOString() });
    router.replace({ pathname: "/visit-detail", params: { id } });
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back}><MaterialIcons color="#547087" name="arrow-back" size={22} /></Pressable><View><Text style={styles.title}>Plan a visit</Text><Text style={styles.subtitle}>Schedule the next accountable customer stop.</Text></View></View>
        {data.customers.length === 0 ? <Surface style={styles.noCustomer}><MaterialIcons color="#159FBE" name="person-add" size={32} /><Text style={styles.noCustomerTitle}>Add a customer first.</Text><Text style={styles.noCustomerBody}>Visits must be tied to a known customer and location.</Text><FieldButton icon="groups" label="Open customer directory" onPress={() => router.push("/customers")} style={{ width: "100%", marginTop: 6 }} /></Surface> : <><Text style={styles.label}>CUSTOMER</Text><View style={styles.customerList}>{data.customers.map((customer) => <Pressable key={customer.id} onPress={() => setSelectedCustomerId(customer.id)} style={[styles.customerOption, customer.id === selectedCustomerId && styles.customerSelected]}><View style={[styles.radio, customer.id === selectedCustomerId && styles.radioSelected]}>{customer.id === selectedCustomerId ? <View style={styles.radioDot} /> : null}</View><View style={{ flex: 1 }}><Text style={styles.customerName}>{customer.name}</Text><Text style={styles.customerAddress}>{customer.address ?? "Address not recorded"}</Text></View>{customer.latitude ? <MaterialIcons color="#22B573" name="location-on" size={19} /> : null}</Pressable>)}</View><Text style={styles.label}>SCHEDULED TIME</Text><TextInput autoCapitalize="none" onChangeText={setDateText} placeholder="2026-08-21T14:30" placeholderTextColor="#7E96A9" style={styles.input} value={dateText} /><Surface style={styles.summary}><Text style={styles.summaryLabel}>VISIT SUMMARY</Text><Text style={styles.summaryTitle}>{selectedCustomer?.name ?? "No customer selected"}</Text><Text style={styles.summaryBody}>A GPS and photo check-in will be required at the customer location. The schedule is stored locally before synchronization.</Text></Surface><FieldButton icon="event-available" label="Create planned visit" onPress={planVisit} /></>}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EBF0", justifyContent: "center", alignItems: "center" },
  title: { color: "#17354A", fontSize: 23, fontWeight: "900" },
  subtitle: { color: "#7E96A9", fontSize: 12, marginTop: 3 },
  label: { color: "#0FA99F", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  customerList: { gap: 8 },
  customerOption: { flexDirection: "row", alignItems: "center", gap: 11, padding: 13, borderRadius: 17, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EBF0" },
  customerSelected: { borderColor: "#13C5B8", backgroundColor: "#EAF9F8" },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#74899A", alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: "#13C5B8" },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#13C5B8" },
  customerName: { color: "#17354A", fontWeight: "800", fontSize: 14 },
  customerAddress: { color: "#7E96A9", fontSize: 11, marginTop: 3 },
  input: { backgroundColor: "#F8FBFC", borderWidth: 1, borderColor: "#DDEAF0", color: "#17354A", minHeight: 51, borderRadius: 14, paddingHorizontal: 13, fontSize: 14 },
  summary: { gap: 6 },
  summaryLabel: { color: "#0FA99F", fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  summaryTitle: { color: "#17354A", fontSize: 17, fontWeight: "800" },
  summaryBody: { color: "#7E96A9", fontSize: 12, lineHeight: 18 },
  noCustomer: { alignItems: "center", gap: 10, paddingVertical: 36 },
  noCustomerTitle: { color: "#17354A", fontSize: 17, fontWeight: "800" },
  noCustomerBody: { color: "#7E96A9", fontSize: 12, textAlign: "center" },
});
