import { Platform, StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LiquidGlassTabBackground } from "@/components/liquid-glass-tab-background";
import { useFieldData } from "@/lib/field-data";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 8 : Math.max(insets.bottom, 8);
  const { data } = useFieldData();

  const role = data.session?.role || "employee";
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isEmployee = role === "employee";

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
      {/* 1. Primary Home/Dashboard Screen (Shared by All Roles) */}
      <Tabs.Screen
        name="index"
        options={{
          title: isAdmin ? "Dashboard" : isManager ? "Dashboard" : "Home",
          tabBarIcon: ({ color }) => (
            <IconSymbol color={color} name={isAdmin ? "chart.bar.fill" : isManager ? "house.fill" : "house.fill"} size={24} />
          ),
        }}
      />

      {/* 2. Admin Users Tab (Admin Only) */}
      <Tabs.Screen
        name="users"
        options={{
          title: "Users",
          href: isAdmin ? "/(tabs)/users" : null,
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="person.3.fill" size={24} />,
        }}
      />

      {/* 3. Manager Team Tab (Manager Only) */}
      <Tabs.Screen
        name="team"
        options={{
          title: "My Team",
          href: isManager ? "/(tabs)/team" : null,
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="person.3.fill" size={24} />,
        }}
      />

      {/* 4. Tasks Tab (All Roles) */}
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="checklist" size={24} />,
        }}
      />

      {/* 5. Employee Visits Tab (Employee Only) */}
      <Tabs.Screen
        name="visits"
        options={{
          title: "Visits",
          href: isEmployee ? "/(tabs)/visits" : null,
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="calendar" size={24} />,
        }}
      />

      {/* 6. Employee Track Tab (Employee Only) */}
      <Tabs.Screen
        name="track"
        options={{
          title: "Track",
          href: isEmployee ? "/(tabs)/track" : null,
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="location.fill" size={24} />,
        }}
      />

      {/* 7. Manager Operational Map Tab (Manager Only) */}
      <Tabs.Screen
        name="map"
        options={{
          title: "Team Map",
          href: isManager ? "/(tabs)/map" : null,
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="map.fill" size={24} />,
        }}
      />

      {/* 8. Reports Tab (Admin & Manager) */}
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          href: isAdmin || isManager ? "/(tabs)/reports" : null,
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="chart.bar.fill" size={24} />,
        }}
      />

      {/* 9. Profile Tab (All Roles) */}
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <IconSymbol color={color} name="person.fill" size={24} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
    marginHorizontal: "auto",
    maxWidth: 500,
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
