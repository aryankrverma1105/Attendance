import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>["name"]>;

const MAPPING: IconMapping = {
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  calendar: "event",
  "location.fill": "my-location",
  "chart.bar.fill": "bar-chart",
  "person.fill": "person",
  "person.3.fill": "groups",
  "person.2.fill": "people",
  checklist: "assignment",
  "map.fill": "map",
  "payments.fill": "payments",
  "solar.fill": "wb-sunny",
};

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: string;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  const iconName = MAPPING[name] || "circle";
  return <MaterialIcons color={color as string} name={iconName} size={size} style={style} />;
}
