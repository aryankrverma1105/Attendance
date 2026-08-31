import { StyleSheet, Text, View } from "react-native";
import type { LatLng } from "react-native-maps";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

export function MapPinPicker({ coordinate }: { coordinate: LatLng; onChange: (coordinate: LatLng) => void }) {
  return (
    <View style={styles.placeholder}>
      <MaterialIcons color="#159FBE" name="map" size={27} />
      <Text style={styles.title}>Map pin ready for Android preview</Text>
      <Text style={styles.body}>The current site pin is {coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)}. Tap-to-drop is available in the Android build after Google Maps configuration.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { minHeight: 130, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: "#BFDCE8", backgroundColor: "#F2F9FC", padding: 16, alignItems: "center", justifyContent: "center", gap: 7 },
  title: { color: "#17354A", fontSize: 13, fontWeight: "800" },
  body: { color: "#7E96A9", fontSize: 11, lineHeight: 16, textAlign: "center" },
});
