export function shouldStartTrackingAfterAttendance(input: { attendanceAction: "check-in" | "check-out"; trackingActive: boolean }) {
  return input.attendanceAction === "check-in" && !input.trackingActive;
}
