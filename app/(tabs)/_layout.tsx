import { Platform, StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LiquidGlassTabBackground } from "@/components/liquid-glass-tab-background";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 8 : Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#D97706",
        tabBarInactiveTintColor: "#1E293B",
        tabBarButton: HapticTab,
        tabBarBackground: () => <LiquidGlassTabBackground />,
        sceneStyle: { marginBottom: 69 + bottomPadding },
        tabBarStyle: [styles.tabBar, { height: 60 + bottomPadding, paddingBottom: bottomPadding + 2 }],
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <IconSymbol color={color} name="house.fill" size={24} /> }} />
      <Tabs.Screen name="visits" options={{ title: "Visits", tabBarIcon: ({ color }) => <IconSymbol color={color} name="calendar" size={24} /> }} />
      <Tabs.Screen name="track" options={{ title: "Track", tabBarIcon: ({ color }) => <IconSymbol color={color} name="location.fill" size={24} /> }} />
      <Tabs.Screen name="reports" options={{ title: "Reports", tabBarIcon: ({ color }) => <IconSymbol color={color} name="chart.bar.fill" size={24} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color }) => <IconSymbol color={color} name="person.fill" size={24} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    left: "6%",
    width: "88%",
    bottom: 12,
    backgroundColor: "transparent",
    borderTopWidth: 0,
    borderRadius: 28,
    paddingTop: 6,
    elevation: 20,
    shadowColor: "#0B192C",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    overflow: "visible",
  },
  tabItem: { paddingHorizontal: 0 },
  label: { fontSize: 11, fontWeight: "900", marginTop: 2, letterSpacing: -0.1 },
});
