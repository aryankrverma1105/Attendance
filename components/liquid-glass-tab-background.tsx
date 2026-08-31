import { StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";

export function LiquidGlassTabBackground() {
  return (
    <View pointerEvents="none" style={styles.clip}>
      <BlurView experimentalBlurMethod="dimezisBlurView" intensity={82} tint="light" style={StyleSheet.absoluteFill} />
      <View style={styles.tint} />
      <View style={styles.highlight} />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    borderRadius: 28,
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0B192C",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(248, 250, 252, 0.6)" },
  highlight: { position: "absolute", top: 0, left: 25, right: 25, height: 1, backgroundColor: "#FFFFFF" },
});
