import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, SectionHeading, Surface } from "@/components/field-ui";
import { MapPinPicker } from "@/components/map-pin-picker";
import { ScreenContainer } from "@/components/screen-container";
import { useFieldData } from "@/lib/field-data";

export default function CustomersScreen() {
  const router = useRouter();
  const { data, addCustomer } = useFieldData();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<{ latitude?: number; longitude?: number }>({});
  const [isLocating, setIsLocating] = useState(false);

  const pinCurrentLocation = async () => {
    setIsLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert("Location required", "Allow location access to pin the customer site.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch {
      Alert.alert("Pin unavailable", "The current location could not be captured. You can still add this customer without a pin.");
    } finally {
      setIsLocating(false);
    }
  };

  const saveCustomer = () => {
    if (!name.trim()) {
      Alert.alert("Customer name required", "Add a customer name before saving this customer.");
      return;
    }
    addCustomer({ name: name.trim(), phone: phone.trim() || undefined, address: address.trim() || undefined, ...location });
    setName("");
    setPhone("");
    setAddress("");
    setLocation({});
    setShowForm(false);
  };

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back}><MaterialIcons color="#547087" name="arrow-back" size={22} /></Pressable><View style={{ flex: 1 }}><Text style={styles.title}>Customers</Text><Text style={styles.subtitle}>Contacts, sites, and verified visit locations.</Text></View><Pressable onPress={() => setShowForm((value) => !value)} style={styles.add}><MaterialIcons color="#17354A" name={showForm ? "close" : "person-add"} size={21} /></Pressable></View>
        {showForm ? <Surface style={styles.form}><Text style={styles.formTitle}>Add customer</Text><TextInput onChangeText={setName} placeholder="Customer or business name" placeholderTextColor="#7E96A9" style={styles.input} value={name} /><TextInput keyboardType="phone-pad" onChangeText={setPhone} placeholder="Phone number" placeholderTextColor="#7E96A9" style={styles.input} value={phone} /><TextInput multiline onChangeText={setAddress} placeholder="Address" placeholderTextColor="#7E96A9" style={[styles.input, styles.addressInput]} value={address} /><View style={styles.pinCard}><View style={{ flex: 1 }}><Text style={styles.pinTitle}>{location.latitude ? "Site pin captured" : "Customer site pin"}</Text><Text style={styles.pinBody}>{location.latitude ? `${location.latitude.toFixed(5)}, ${location.longitude?.toFixed(5)}` : "Capture the current site before dropping or refining the pin on the map."}</Text></View><Pressable onPress={pinCurrentLocation} style={styles.pinButton}><MaterialIcons color="#17354A" name="my-location" size={19} /></Pressable></View>{location.latitude !== undefined && location.longitude !== undefined ? <MapPinPicker coordinate={{ latitude: location.latitude, longitude: location.longitude }} onChange={(coordinate) => setLocation(coordinate)} /> : null}<FieldButton disabled={isLocating} icon="save" label={isLocating ? "Capturing pin…" : "Save customer"} onPress={saveCustomer} /></Surface> : null}
        <SectionHeading title={`Directory · ${data.customers.length}`} />
        {data.customers.length > 0 ? <View style={styles.list}>{data.customers.map((customer) => <Surface key={customer.id} style={styles.customer}><View style={styles.customerIcon}><MaterialIcons color="#17354A" name="storefront" size={20} /></View><View style={{ flex: 1, gap: 3 }}><Text style={styles.customerName}>{customer.name}</Text><Text style={styles.customerMeta}>{customer.address ?? "Address not recorded"}</Text><Text style={styles.customerMeta}>{customer.phone ?? "Phone not recorded"}</Text></View>{customer.latitude ? <MaterialIcons color="#22B573" name="location-on" size={20} /> : null}</Surface>)}</View> : <Surface style={styles.empty}><MaterialIcons color="#159FBE" name="groups" size={31} /><Text style={styles.emptyTitle}>Start with a customer.</Text><Text style={styles.emptyBody}>Customer profiles connect your field visits to contact details, locations, and activity evidence.</Text><FieldButton icon="person-add" label="Add your first customer" onPress={() => setShowForm(true)} style={{ width: "100%", marginTop: 8 }} /></Surface>}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 18, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", gap: 11 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EBF0", alignItems: "center", justifyContent: "center" },
  title: { color: "#17354A", fontSize: 23, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: "#7E96A9", fontSize: 12, lineHeight: 17, marginTop: 3 },
  add: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#DDF8F5", borderWidth: 1, borderColor: "#C6ECE8", alignItems: "center", justifyContent: "center" },
  form: { gap: 10 },
  formTitle: { color: "#17354A", fontSize: 17, fontWeight: "800", marginBottom: 2 },
  input: { backgroundColor: "#F8FBFC", borderWidth: 1, borderColor: "#DDEAF0", color: "#17354A", minHeight: 50, borderRadius: 14, paddingHorizontal: 13, fontSize: 14 },
  addressInput: { minHeight: 76, paddingTop: 13, textAlignVertical: "top" },
  pinCard: { backgroundColor: "#F0F7FA", borderRadius: 15, padding: 12, flexDirection: "row", gap: 12, alignItems: "center" },
  pinTitle: { color: "#17354A", fontSize: 13, fontWeight: "800" },
  pinBody: { color: "#7E96A9", fontSize: 11, lineHeight: 16, marginTop: 3 },
  pinButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#DDF8F5", alignItems: "center", justifyContent: "center" },
  list: { gap: 10 },
  customer: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  customerIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#DDF8F5", alignItems: "center", justifyContent: "center" },
  customerName: { color: "#17354A", fontSize: 15, fontWeight: "800" },
  customerMeta: { color: "#7E96A9", fontSize: 12, lineHeight: 16 },
  empty: { alignItems: "center", gap: 10, paddingVertical: 34 },
  emptyTitle: { color: "#17354A", fontSize: 17, fontWeight: "800" },
  emptyBody: { color: "#7E96A9", textAlign: "center", fontSize: 12, lineHeight: 18, maxWidth: 270 },
});
