import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

export function DepthOrb() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 5200, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [progress]);

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 800 },
      { translateX: interpolate(progress.value, [0, 1], [-8, 14]) },
      { translateY: interpolate(progress.value, [0, 1], [6, -12]) },
      { rotateY: `${interpolate(progress.value, [0, 1], [-12, 16])}deg` },
      { rotateX: `${interpolate(progress.value, [0, 1], [5, -9])}deg` },
    ],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.45, 0.85]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.92, 1.08]) }],
  }));

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.halo, haloStyle]} />
      <Animated.View style={[styles.orb, orbitStyle]}>
        <LinearGradient colors={["#FFFFFF", "#A2F0E8", "#19B7AD"]} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={styles.gradient} />
        <View style={styles.glint} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 118, height: 118, justifyContent: "center", alignItems: "center" },
  halo: { position: "absolute", width: 108, height: 108, borderRadius: 54, backgroundColor: "rgba(19,197,184,0.16)", shadowColor: "#13C5B8", shadowOpacity: 0.34, shadowRadius: 26, elevation: 6 },
  orb: { width: 72, height: 72, borderRadius: 28, overflow: "hidden", shadowColor: "#13C5B8", shadowOpacity: 0.32, shadowRadius: 18, elevation: 8 },
  gradient: { flex: 1 },
  glint: { position: "absolute", top: 10, left: 12, width: 25, height: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.64)", transform: [{ rotate: "-22deg" }] },
});
