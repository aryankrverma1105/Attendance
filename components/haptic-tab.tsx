import { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

export function HapticTab(props: BottomTabBarButtonProps) {
  const isSelected = Boolean(props.accessibilityState?.selected);
  const progress = useSharedValue(isSelected ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(isSelected ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [isSelected, progress]);

  const selectionStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ["rgba(255,255,255,0)", "rgba(19,197,184,0.15)"]),
    borderColor: interpolateColor(progress.value, [0, 1], ["rgba(255,255,255,0)", "rgba(19,197,184,0.18)"]),
    transform: [{ scale: 0.96 + progress.value * 0.04 }, { translateY: (1 - progress.value) * 1 }],
  }));

  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === "ios") {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    >
      <Animated.View style={[styles.selection, selectionStyle]}>{props.children}</Animated.View>
    </PlatformPressable>
  );
}

const styles = StyleSheet.create({
  selection: { flex: 1, minHeight: 44, marginHorizontal: 3, marginVertical: 3, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
