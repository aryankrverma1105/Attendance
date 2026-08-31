import { StyleSheet, View } from "react-native";
import MapView, { Marker, type LatLng } from "react-native-maps";

export function MapPinPicker({ coordinate, onChange }: { coordinate: LatLng; onChange: (coordinate: LatLng) => void }) {
  return (
    <View style={styles.wrap}>
      <MapView
        initialRegion={{ ...coordinate, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
        onPress={(event) => onChange(event.nativeEvent.coordinate)}
        style={styles.map}
      >
        <Marker coordinate={coordinate} title="Customer site" description="Tap the map to move this pin." pinColor="#06B6B3" />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 190, overflow: "hidden", borderRadius: 16, borderWidth: 1, borderColor: "#28475F" },
  map: { flex: 1 },
});
