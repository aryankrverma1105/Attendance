import { Platform, StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { HapticTab } from "@/components/haptic-tab";
import { LiquidGlassTabBackground } from "@/components/liquid-glass-tab-background";
import { useFieldData } from "@/lib/field-data";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(insets.bottom, 10);
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
        tabBarInactiveTintColor: "#64748B",
        tabBarButton: HapticTab,
        tabBarBackground: () => <LiquidGlassTabBackground />,
        sceneStyle: { marginBottom: 72 + bottomPadding },
        tabBarStyle: [
          styles.tabBar,
          { height: 64 + bottomPadding, paddingBottom: bottomPadding + 2 },
        ],
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      {/* 1. Primary Home / Dashboard Screen (Shared by All Roles) */}
      <Tabs.Screen
        name="index"
        options={{
          title: isAdmin ? "Dashboard" : isManager ? "Dashboard" : "Home",
          tabBarIcon: ({ color, focused }) => (
            <MaterialIcons
              color={color}
              name={isAdmin ? "dashboard" : "home"}
              size={24}
            />
          ),
        }}
      />

      {/* 2. Admin Users Tab (Admin Only - 5 Tab Suite) */}
      <Tabs.Screen
        name="users"
        options={{
          title: "Users",
          href: isAdmin ? "/(tabs)/users" : null,
          tabBarIcon: ({ color }) => (
            <MaterialIcons color={color} name="people" size={24} />
          ),
        }}
      />

      {/* 3. Manager Team Tab (Manager Only - 5 Tab Suite) */}
      <Tabs.Screen
        name="team"
        options={{
          title: "My Team",
          href: isManager ? "/(tabs)/team" : null,
          tabBarIcon: ({ color }) => (
            <MaterialIcons color={color} name="groups" size={24} />
          ),
        }}
      />

      {/* 4. Tasks Tab (All Roles) */}
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color }) => (
            <MaterialIcons color={color} name="assignment" size={24} />
          ),
        }}
      />

      {/* 5. Employee Visits Tab (Employee Only - 5 Tab Suite) */}
      <Tabs.Screen
        name="visits"
        options={{
          title: "Visits",
          href: isEmployee ? "/(tabs)/visits" : null,
          tabBarIcon: ({ color }) => (
            <MaterialIcons color={color} name="event" size={24} />
          ),
        }}
      />

      {/* 6. Employee Track Tab (Employee Only - 5 Tab Suite) */}
      <Tabs.Screen
        name="track"
        options={{
          title: "Track",
          href: isEmployee ? "/(tabs)/track" : null,
          tabBarIcon: ({ color }) => (
            <MaterialIcons color={color} name="my-location" size={24} />
          ),
        }}
      />

      {/* 7. Manager Operational Map Tab (Manager Only - 5 Tab Suite) */}
      <Tabs.Screen
        name="map"
        options={{
          title: "Team Map",
          href: isManager ? "/(tabs)/map" : null,
          tabBarIcon: ({ color }) => (
            <MaterialIcons color={color} name="map" size={24} />
          ),
        }}
      />

      {/* 8. Admin Reports Tab (Admin Only - 5 Tab Suite) */}
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          href: isAdmin ? "/(tabs)/reports" : null,
          tabBarIcon: ({ color }) => (
            <MaterialIcons color={color} name="bar-chart" size={24} />
          ),
        }}
      />

      {/* 9. Profile Tab (All Roles) */}
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <MaterialIcons color={color} name="person" size={24} />
          ),
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
    paddingTop: 8,
    elevation: 20,
    shadowColor: "#0B192C",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    overflow: "visible",
  },
  tabItem: {
    paddingHorizontal: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
    letterSpacing: -0.2,
  },
});
