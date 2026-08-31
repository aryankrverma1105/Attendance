import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import {
  calculateEarnings,
  calculateWorkedDays,
  calculateWorkingDaysInMonth,
  formatCurrency,
  formatDay,
  getMonthlyWorkedDaysBreakdown,
  useFieldData,
} from "@/lib/field-data";
import { trpc } from "@/lib/trpc";

export default function EarningsScreen() {
  const router = useRouter();
  const { data } = useFieldData();
  const [selectedTab, setSelectedTab] = useState<"current" | "history">("current");

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentMonthName = now.toLocaleString("default", { month: "long" });

  // Get current user details from workspace session
  const user = data.session;
  const currentDailyWage = user?.dailyWage ?? 0;

  // Filter attendance records belonging to this employee
  const employeeAttendance = useMemo(
    () =>
      data.attendance.filter(
        (record) => !record.employeeId || record.employeeId === user?.id
      ),
    [data.attendance, user?.id]
  );

  // Calculate worked days & working days
  const { workedDays, uniqueDates } = useMemo(
    () => calculateWorkedDays(employeeAttendance, currentMonth, currentYear),
    [employeeAttendance, currentMonth, currentYear]
  );

  const workingDaysInMonth = useMemo(
    () => calculateWorkingDaysInMonth(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const calculatedEarnings = useMemo(
    () => calculateEarnings(workedDays, currentDailyWage),
    [workedDays, currentDailyWage]
  );

  // Month-by-month history
  const monthlyHistory = useMemo(
    () => getMonthlyWorkedDaysBreakdown(employeeAttendance, currentDailyWage, 6),
    [employeeAttendance, currentDailyWage]
  );

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons color="#0B192C" name="arrow-back" size={22} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>COMPENSATION & PAYOUTS</Text>
            <Text style={styles.title}>My Earnings</Text>
            <Text style={styles.subtitle}>
              {currentMonthName} {currentYear} · Verified Field Work
            </Text>
          </View>
        </View>

        {/* Hero Earnings Banner */}
        <LinearGradient
          colors={["#0A192F", "#0F172A", "#1E293B"]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={styles.heroCard}
        >
          <View style={styles.heroTop}>
            <StatusChip label="ESTIMATED EARNINGS" tone="solar" />
            <Text style={styles.heroMonth}>
              {currentMonthName} {currentYear}
            </Text>
          </View>

          <View style={styles.heroAmountWrap}>
            <Text style={styles.heroAmount}>{formatCurrency(calculatedEarnings)}</Text>
            <Text style={styles.heroSubtext}>
              Based on {workedDays} verified worked days this month
            </Text>
          </View>

          <View style={styles.heroDivider} />

          <View style={styles.heroStatsRow}>
            <View style={styles.heroStatItem}>
              <Text style={styles.heroStatLabel}>DAILY WAGE</Text>
              <Text style={styles.heroStatValue}>
                {formatCurrency(currentDailyWage)}
                <Text style={styles.heroStatUnit}> / day</Text>
              </Text>
            </View>

            <View style={styles.heroStatDivider} />

            <View style={styles.heroStatItem}>
              <Text style={styles.heroStatLabel}>WORKED DAYS</Text>
              <Text style={styles.heroStatValue}>
                {workedDays}
                <Text style={styles.heroStatUnit}> / {workingDaysInMonth} days</Text>
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* Tabs: Current Breakdown vs Month History */}
        <View style={styles.tabsRow}>
          <Pressable
            onPress={() => setSelectedTab("current")}
            style={[styles.tabButton, selectedTab === "current" && styles.tabButtonActive]}
          >
            <MaterialIcons
              color={selectedTab === "current" ? "#0B192C" : "#64748B"}
              name="calculate"
              size={18}
            />
            <Text
              style={[
                styles.tabButtonText,
                selectedTab === "current" && styles.tabButtonTextActive,
              ]}
            >
              Current Breakdown
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelectedTab("history")}
            style={[styles.tabButton, selectedTab === "history" && styles.tabButtonActive]}
          >
            <MaterialIcons
              color={selectedTab === "history" ? "#0B192C" : "#64748B"}
              name="history"
              size={18}
            />
            <Text
              style={[
                styles.tabButtonText,
                selectedTab === "history" && styles.tabButtonTextActive,
              ]}
            >
              Past Months
            </Text>
          </Pressable>
        </View>

        {selectedTab === "current" ? (
          <>
            {/* Calculation Formula Card */}
            <SectionHeading title="Calculation Details" />
            <Surface style={styles.formulaCard}>
              <View style={styles.formulaRow}>
                <Text style={styles.formulaLabel}>Configured Daily Wage</Text>
                <Text style={styles.formulaValue}>{formatCurrency(currentDailyWage)}</Text>
              </View>

              <View style={styles.formulaRow}>
                <Text style={styles.formulaLabel}>Verified Worked Days</Text>
                <Text style={styles.formulaValue}>× {workedDays} days</Text>
              </View>

              <View style={styles.formulaDivider} />

              <View style={styles.formulaRow}>
                <Text style={styles.formulaTotalLabel}>Estimated Monthly Payout</Text>
                <Text style={styles.formulaTotalValue}>
                  {formatCurrency(calculatedEarnings)}
                </Text>
              </View>
            </Surface>

            {/* Verified Worked Dates */}
            <SectionHeading
              subtitle="Each unique calendar date with a verified attendance check-in"
              title="Verified Worked Dates"
            />
            {uniqueDates.length > 0 ? (
              <View style={styles.datesList}>
                {uniqueDates.map((dateStr, idx) => (
                  <Surface key={dateStr} style={styles.dateRow}>
                    <View style={styles.dateNumberWrap}>
                      <Text style={styles.dateNumber}>#{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dateTitle}>{formatDay(dateStr)}</Text>
                      <Text style={styles.dateSubtitle}>
                        GPS Verified Check-in · 1 Full Worked Day
                      </Text>
                    </View>
                    <StatusChip label="Earned" tone="success" />
                  </Surface>
                ))}
              </View>
            ) : (
              <Surface style={styles.emptyCard}>
                <MaterialIcons color="#F59E0B" name="event-available" size={32} />
                <Text style={styles.emptyTitle}>No verified worked days yet this month.</Text>
                <Text style={styles.emptyBody}>
                  Record your attendance with photo and verified GPS fix to start logging
                  worked days and calculated earnings.
                </Text>
                <FieldButton
                  icon="verified-user"
                  label="Check in now"
                  onPress={() => router.push({ pathname: "/attendance", params: { action: "check-in" } })}
                  style={{ marginTop: 8 }}
                />
              </Surface>
            )}
          </>
        ) : (
          <>
            {/* Past Months Breakdown */}
            <SectionHeading
              subtitle="Calculations based on effective daily wage during each period"
              title="Historical Payouts"
            />
            <View style={styles.historyList}>
              {monthlyHistory.map((item) => (
                <Surface key={`${item.year}-${item.month}`} style={styles.historyCard}>
                  <View style={styles.historyHeader}>
                    <View>
                      <Text style={styles.historyMonth}>
                        {item.monthName} {item.year}
                      </Text>
                      <Text style={styles.historyMeta}>
                        {item.workedDays} worked days · {formatCurrency(item.dailyWage)}/day
                      </Text>
                    </View>
                    <Text style={styles.historyEarnings}>
                      {formatCurrency(item.calculatedEarnings)}
                    </Text>
                  </View>
                </Surface>
              ))}
            </View>
          </>
        )}

        {/* Note / Disclaimer */}
        <Surface style={styles.disclaimerCard}>
          <MaterialIcons color="#D97706" name="info-outline" size={20} />
          <Text style={styles.disclaimerText}>
            Wages and earnings are calculated from verified field attendance. Official payroll
            disbursements are processed by company finance according to monthly billing
            cycles.
          </Text>
        </Surface>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 18, paddingBottom: 36 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: {
    color: "#D97706",
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "900",
    marginBottom: 2,
  },
  title: { color: "#0B192C", fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: "#64748B", fontSize: 12, marginTop: 2 },
  heroCard: {
    borderRadius: 26,
    padding: 22,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    shadowColor: "#0A192F",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 6,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroMonth: { color: "#94A3B8", fontSize: 12, fontWeight: "700" },
  heroAmountWrap: { marginVertical: 16 },
  heroAmount: {
    color: "#FBBF24",
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -1,
  },
  heroSubtext: {
    color: "#E2E8F0",
    fontSize: 13,
    marginTop: 4,
  },
  heroDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    marginVertical: 12,
  },
  heroStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroStatItem: { flex: 1 },
  heroStatLabel: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  heroStatValue: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  heroStatUnit: { color: "#94A3B8", fontSize: 12, fontWeight: "600" },
  heroStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    marginHorizontal: 16,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#F1F5F9",
    padding: 4,
    borderRadius: 16,
  },
  tabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
  tabButtonActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  tabButtonText: { color: "#64748B", fontSize: 13, fontWeight: "700" },
  tabButtonTextActive: { color: "#0B192C", fontWeight: "900" },
  formulaCard: { gap: 10 },
  formulaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  formulaLabel: { color: "#64748B", fontSize: 13 },
  formulaValue: { color: "#0B192C", fontSize: 14, fontWeight: "800" },
  formulaDivider: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 2 },
  formulaTotalLabel: { color: "#0B192C", fontSize: 14, fontWeight: "900" },
  formulaTotalValue: { color: "#D97706", fontSize: 18, fontWeight: "900" },
  datesList: { gap: 8 },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  dateNumberWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  dateNumber: { color: "#92400E", fontSize: 12, fontWeight: "900" },
  dateTitle: { color: "#0B192C", fontSize: 14, fontWeight: "800" },
  dateSubtitle: { color: "#64748B", fontSize: 11, marginTop: 2 },
  emptyCard: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  emptyTitle: { color: "#0B192C", fontSize: 16, fontWeight: "800" },
  emptyBody: {
    color: "#64748B",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 280,
  },
  historyList: { gap: 10 },
  historyCard: { padding: 16 },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyMonth: { color: "#0B192C", fontSize: 15, fontWeight: "900" },
  historyMeta: { color: "#64748B", fontSize: 12, marginTop: 3 },
  historyEarnings: { color: "#059669", fontSize: 18, fontWeight: "900" },
  disclaimerCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  disclaimerText: {
    flex: 1,
    color: "#92400E",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
  },
});
