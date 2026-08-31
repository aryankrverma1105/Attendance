import { StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import type { RoutePoint } from "@/lib/field-types";

export function RouteMap({ points }: { points: RoutePoint[] }) {
  const last = points.at(-1);
  return (
    <View style={styles.placeholder}>
      <MaterialIcons color="#159FBE" name="map" size={27} />
      <Text style={styles.title}>Route map is available in the Android build</Text>
      <Text style={styles.body}>{last ? `Latest protected point: ${last.latitude.toFixed(5)}, ${last.longitude.toFixed(5)}. The Android native map renders the full route.` : "No GPS route points have been stored for this employee."}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { minHeight: 140, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: "#BFDCE8", backgroundColor: "#F2F9FC", padding: 16, alignItems: "center", justifyContent: "center", gap: 7 },
  title: { color: "#17354A", fontSize: 13, fontWeight: "800", textAlign: "center" },
  body: { color: "#7E96A9", fontSize: 11, lineHeight: 16, textAlign: "center" },
});
