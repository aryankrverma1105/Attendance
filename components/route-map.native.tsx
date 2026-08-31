import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import type { RoutePoint } from "@/lib/field-types";

export function RouteMap({ points }: { points: RoutePoint[] }) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return <View style={styles.empty}><MaterialIcons color="#159FBE" name="location-searching" size={28} /><Text style={styles.emptyText}>No GPS route points have been stored for this employee.</Text></View>;
  const coordinates = points.map((point) => ({ latitude: point.latitude, longitude: point.longitude }));
  return <View style={styles.wrap}><MapView initialRegion={{ latitude: last.latitude, longitude: last.longitude, latitudeDelta: 0.018, longitudeDelta: 0.018 }} style={styles.map}><Polyline coordinates={coordinates} strokeColor="#06B6B3" strokeWidth={4} /><Marker coordinate={{ latitude: first.latitude, longitude: first.longitude }} pinColor="#16A36A" title="Route start" /><Marker coordinate={{ latitude: last.latitude, longitude: last.longitude }} pinColor="#E69B2D" title="Latest point" /></MapView></View>;
}

const styles = StyleSheet.create({
  wrap: { height: 230, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#DDEAF0" },
  map: { flex: 1 },
  empty: { minHeight: 140, borderRadius: 16, backgroundColor: "#F2F9FC", borderWidth: 1, borderColor: "#DDEAF0", alignItems: "center", justifyContent: "center", gap: 8, padding: 16 },
  emptyText: { color: "#7E96A9", fontSize: 12, textAlign: "center" },
});
