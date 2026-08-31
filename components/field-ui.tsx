import { useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { formatCurrency } from "@/lib/field-math";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "amber";

export function FieldButton({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isInteractionDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isInteractionDisabled }}
      disabled={isInteractionDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        buttonStyles[variant],
        isInteractionDisabled && styles.disabled,
        pressed && !isInteractionDisabled && styles.pressed,
        style,
      ]}
    >
      {icon ? (
        <MaterialIcons
          color={
            variant === "quiet"
              ? "#64748B"
              : variant === "danger"
              ? "#DC2626"
              : variant === "primary" || variant === "amber"
              ? "#0B192C"
              : "#0B192C"
          }
          name={icon}
          size={19}
        />
      ) : null}
      <Text
        style={[
          styles.buttonText,
          variant === "quiet" && styles.quietText,
          variant === "danger" && styles.dangerText,
          (variant === "primary" || variant === "amber") && styles.primaryButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function StatusChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "success" | "warning" | "danger" | "neutral" | "solar";
}) {
  return (
    <View style={[styles.chip, chipStyles[tone]]}>
      <View style={[styles.chipDot, dotStyles[tone]]} />
      <Text style={[styles.chipText, chipTextStyles[tone]]}>{label}</Text>
    </View>
  );
}

export function SectionHeading({
  title,
  action,
  subtitle,
}: {
  title: string;
  action?: ReactNode;
  subtitle?: string;
}) {
  return (
    <View style={styles.sectionHeadingWrap}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Surface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

/**
 * Solar-designed Metric Card for Dashboard KPIs
 */
export function MetricCard({
  icon,
  label,
  value,
  subtitle,
  trend,
  tone = "default",
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  value: string;
  subtitle?: string;
  trend?: string;
  tone?: "default" | "success" | "amber" | "navy";
  onPress?: () => void;
}) {
  const CardComponent = onPress ? Pressable : View;

  return (
    <CardComponent
      onPress={onPress}
      style={({ pressed }: any) => [
        styles.metricCard,
        tone === "amber" && styles.metricAmber,
        tone === "success" && styles.metricSuccess,
        tone === "navy" && styles.metricNavy,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.metricHeader}>
        <View
          style={[
            styles.metricIconWrap,
            tone === "amber" && styles.metricIconAmber,
            tone === "success" && styles.metricIconSuccess,
            tone === "navy" && styles.metricIconNavy,
          ]}
        >
          <MaterialIcons
            color={
              tone === "amber"
                ? "#D97706"
                : tone === "success"
                ? "#059669"
                : tone === "navy"
                ? "#0284C7"
                : "#F59E0B"
            }
            name={icon}
            size={18}
          />
        </View>
        <Text style={styles.metricLabel}>{label.toUpperCase()}</Text>
      </View>

      <Text style={styles.metricValue}>{value}</Text>

      {subtitle ? <Text style={styles.metricSubtitle}>{subtitle}</Text> : null}
      {trend ? (
        <View style={styles.trendRow}>
          <MaterialIcons color="#10B981" name="trending-up" size={13} />
          <Text style={styles.trendText}>{trend}</Text>
        </View>
      ) : null}
    </CardComponent>
  );
}

/**
 * Wage Configuration Modal for Admin & Manager
 */
export function WageEditModal({
  visible,
  employeeName,
  currentWage,
  onClose,
  onSave,
}: {
  visible: boolean;
  employeeName: string;
  currentWage: number;
  onClose: () => void;
  onSave: (newWage: number) => void;
}) {
  const [wageText, setWageText] = useState(String(currentWage || ""));
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    const parsed = Number(wageText.trim());
    if (isNaN(parsed) || parsed < 0) {
      setError("Please enter a valid non-negative daily wage.");
      return;
    }
    if (parsed > 100000) {
      setError("Daily wage cannot exceed ₹100,000.");
      return;
    }
    setError(null);
    onSave(Math.round(parsed));
    onClose();
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderIcon}>
              <MaterialIcons color="#D97706" name="payments" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Set Employee Wage</Text>
              <Text style={styles.modalSubtitle}>{employeeName}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <MaterialIcons color="#64748B" name="close" size={20} />
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.inputLabel}>PER-DAY WAGE (INR)</Text>
            <View style={styles.inputRow}>
              <Text style={styles.currencyPrefix}>₹</Text>
              <TextInput
                keyboardType="numeric"
                onChangeText={(val) => {
                  setWageText(val);
                  setError(null);
                }}
                placeholder="e.g. 700"
                placeholderTextColor="#94A3B8"
                style={styles.modalInput}
                value={wageText}
              />
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Text style={styles.previewText}>
              Preview:{" "}
              <Text style={{ fontWeight: "800", color: "#0B192C" }}>
                {formatCurrency(Number(wageText) || 0)} / day
              </Text>
            </Text>

            <Text style={styles.modalNote}>
              Note: Updating the wage creates an audit log and applies to future calculations
              while preserving historical payroll periods.
            </Text>
          </View>

          <View style={styles.modalFooter}>
            <FieldButton
              label="Cancel"
              onPress={onClose}
              style={{ flex: 1 }}
              variant="secondary"
            />
            <FieldButton
              label="Save Wage"
              onPress={handleSave}
              style={{ flex: 1 }}
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const buttonStyles = StyleSheet.create({
  primary: {
    backgroundColor: "#F59E0B",
    shadowColor: "#D97706",
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 3,
  },
  amber: {
    backgroundColor: "#FBBF24",
    shadowColor: "#D97706",
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 2,
  },
  secondary: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  quiet: {
    backgroundColor: "rgba(255,255,255,0.75)",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  danger: {
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
});

const chipStyles = StyleSheet.create({
  success: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  warning: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  solar: { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" },
  danger: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  neutral: { backgroundColor: "#F1F5F9", borderColor: "#E2E8F0" },
});

const dotStyles = StyleSheet.create({
  success: { backgroundColor: "#10B981" },
  warning: { backgroundColor: "#F59E0B" },
  solar: { backgroundColor: "#D97706" },
  danger: { backgroundColor: "#EF4444" },
  neutral: { backgroundColor: "#94A3B8" },
});

const chipTextStyles = StyleSheet.create({
  success: { color: "#047857" },
  warning: { color: "#B45309" },
  solar: { color: "#92400E" },
  danger: { color: "#B91C1C" },
  neutral: { color: "#475569" },
});

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: { color: "#0B192C", fontSize: 15, fontWeight: "800" },
  primaryButtonText: { color: "#0B192C", fontWeight: "900" },
  quietText: { color: "#64748B" },
  dangerText: { color: "#DC2626" },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  disabled: { opacity: 0.45 },
  chip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  chipDot: { width: 6, height: 6, borderRadius: 999 },
  chipText: { fontSize: 12, fontWeight: "700" },
  sectionHeadingWrap: { marginBottom: 12 },
  sectionHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: "#0B192C",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 2,
  },
  surface: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 22,
    padding: 16,
    shadowColor: "#0B192C",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
  metricCard: {
    width: "48.5%",
    minHeight: 118,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 20,
    padding: 14,
    justifyContent: "space-between",
    shadowColor: "#0B192C",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 1,
  },
  metricAmber: {
    borderColor: "#FDE68A",
    backgroundColor: "#FFFCF5",
  },
  metricSuccess: {
    borderColor: "#A7F3D0",
    backgroundColor: "#F7FEFA",
  },
  metricNavy: {
    borderColor: "#BAE6FD",
    backgroundColor: "#F0F9FF",
  },
  metricHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metricIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  metricIconAmber: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  metricIconSuccess: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  metricIconNavy: {
    backgroundColor: "rgba(2, 132, 199, 0.12)",
  },
  metricLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  metricValue: {
    color: "#0B192C",
    fontSize: 21,
    fontWeight: "900",
    marginTop: 8,
    letterSpacing: -0.4,
  },
  metricSubtitle: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  trendText: {
    color: "#059669",
    fontSize: 10,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(11, 25, 44, 0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalContainer: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  modalHeaderIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    color: "#0B192C",
    fontSize: 17,
    fontWeight: "900",
  },
  modalSubtitle: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 2,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  modalBody: {
    gap: 10,
    marginBottom: 20,
  },
  inputLabel: {
    color: "#D97706",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
  },
  currencyPrefix: {
    color: "#0B192C",
    fontSize: 18,
    fontWeight: "900",
    marginRight: 6,
  },
  modalInput: {
    flex: 1,
    minHeight: 48,
    color: "#0B192C",
    fontSize: 17,
    fontWeight: "800",
  },
  previewText: {
    color: "#64748B",
    fontSize: 13,
  },
  errorText: {
    color: "#DC2626",
    fontSize: 12,
    fontWeight: "600",
  },
  modalNote: {
    color: "#94A3B8",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  modalFooter: {
    flexDirection: "row",
    gap: 10,
  },
});
