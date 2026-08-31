import type { AttendanceRecord, LocationEvidence, MonthEarningsBreakdown, RoutePoint } from "@/lib/field-types";

export function classifyLocationEvidence(location: LocationEvidence): "verified" | "review" {
  if (location.mocked) return "review";
  if (location.accuracy !== null && location.accuracy <= 60) return "verified";
  return "review";
}

export function routeDistanceKm(points: RoutePoint[]) {
  if (points.length < 2) return 0;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  let meters = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const dLat = toRadians(current.latitude - previous.latitude);
    const dLon = toRadians(current.longitude - previous.longitude);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRadians(previous.latitude)) * Math.cos(toRadians(current.latitude)) * Math.sin(dLon / 2) ** 2;
    meters += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return meters / 1000;
}

/**
 * Calculates unique calendar days worked based on attendance records.
 * Multiple check-ins/check-outs on the same calendar date count as exactly 1 worked day.
 * If month (1-12) and year are provided, filters to that month.
 */
export function calculateWorkedDays(
  attendanceRecords: AttendanceRecord[],
  month?: number,
  year?: number
): { workedDays: number; uniqueDates: string[] } {
  const uniqueDatesSet = new Set<string>();

  attendanceRecords.forEach((record) => {
    // Only verified or completed attendance counts
    if (record.status !== "verified" && record.status !== "pending") return;
    if (!record.checkInAt) return;

    const date = new Date(record.checkInAt);
    if (isNaN(date.getTime())) return;

    if (year !== undefined && date.getFullYear() !== year) return;
    if (month !== undefined && date.getMonth() + 1 !== month) return;

    const dateKey = date.toISOString().slice(0, 10); // YYYY-MM-DD
    uniqueDatesSet.add(dateKey);
  });

  const uniqueDates = Array.from(uniqueDatesSet).sort();
  return {
    workedDays: uniqueDates.length,
    uniqueDates,
  };
}

/**
 * Calculates total working days in a given month excluding Sundays (Mon–Sat standard).
 */
export function calculateWorkingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOfWeek = new Date(year, month - 1, day).getDay();
    if (dayOfWeek !== 0) {
      // 0 is Sunday
      workingDays++;
    }
  }
  return workingDays;
}

/**
 * Pure calculation for total earnings from worked days and daily wage.
 */
export function calculateEarnings(workedDays: number, dailyWage: number): number {
  const safeDays = Math.max(0, Math.floor(workedDays || 0));
  const safeWage = Math.max(0, Math.floor(dailyWage || 0));
  return safeDays * safeWage;
}

/**
 * Formats a currency number in standard Indian Rupee notation (e.g. ₹15,400).
 */
export function formatCurrency(amount: number): string {
  const safeAmount = Math.max(0, Math.round(amount || 0));
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(safeAmount);
}

/**
 * Builds a month-by-month history of worked days and estimated earnings.
 */
export function getMonthlyWorkedDaysBreakdown(
  attendanceRecords: AttendanceRecord[],
  dailyWage: number,
  monthsCount = 6,
  referenceDate?: Date
): MonthEarningsBreakdown[] {
  const baseDate = referenceDate ? new Date(referenceDate) : new Date();
  const results: MonthEarningsBreakdown[] = [];

  for (let i = 0; i < monthsCount; i++) {
    const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const monthName = targetDate.toLocaleString("default", { month: "long" });

    const { workedDays, uniqueDates } = calculateWorkedDays(attendanceRecords, month, year);
    const calculatedEarnings = calculateEarnings(workedDays, dailyWage);

    results.push({
      year,
      month,
      monthName,
      workedDays,
      dailyWage,
      calculatedEarnings,
      workedDates: uniqueDates,
    });
  }

  return results;
}
