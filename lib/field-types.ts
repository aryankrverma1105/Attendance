export type FieldRole = "employee" | "manager" | "admin";

export type FieldSession = {
  id: string;
  identifier: string;
  displayName: string;
  role: FieldRole;
  isPreview: boolean;
  signedInAt: string;
  dailyWage?: number;
  managerId?: string;
};

export type ManagedUser = {
  id: string;
  accountLinkId: string;
  displayName: string;
  identifier: string;
  role: FieldRole;
  status: "active" | "invited" | "suspended";
  password?: string;
  department?: string;
  dailyWage: number;
  managerId?: string;
  createdAt: string;
  accessIssuedAt?: string;
};

export type WorkedDaysSummary = {
  workedDays: number;
  workingDaysInMonth: number;
  workedDates: string[];
};

export type MonthEarningsBreakdown = {
  year: number;
  month: number;
  monthName: string;
  workedDays: number;
  dailyWage: number;
  calculatedEarnings: number;
  workedDates: string[];
};

export type AccountLifecycleEvent = {
  id: string;
  userId: string;
  accountLinkId: string;
  action: "account-created" | "access-issued" | "account-removed";
  performedById?: string;
  occurredAt: string;
  detail: string;
};

export type LocationEvidence = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
  mocked?: boolean;
};

export type AttendanceRecord = {
  id: string;
  employeeId?: string;
  checkInAt: string;
  checkOutAt?: string;
  checkInPhotoUri?: string;
  checkOutPhotoUri?: string;
  checkInLocation?: LocationEvidence;
  checkOutLocation?: LocationEvidence;
  status: "verified" | "review" | "pending";
  lateEarlyLabel?: "On time" | "Late" | "Early" | "Pending policy";
  syncState: "pending" | "awaiting-server" | "synced";
};

export type Customer = {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
};

export type VisitStatus = "scheduled" | "checked-in" | "completed";

export type Visit = {
  id: string;
  employeeId?: string;
  customerId: string;
  scheduledFor: string;
  status: VisitStatus;
  checkInAt?: string;
  checkOutAt?: string;
  checkInLocation?: LocationEvidence;
  checkOutLocation?: LocationEvidence;
  evidenceUris: string[];
  meetingOutcome?: string;
  notes?: string;
  followUpDate?: string;
};

export type ChatMessage = {
  id: string;
  text: string;
  sender: "employee" | "manager";
  createdAt: string;
  delivery: "pending" | "awaiting-server" | "delivered";
};

export type RoutePoint = LocationEvidence & {
  id: string;
  employeeId?: string;
};

export type OfflineOperation = {
  id: string;
  category: "attendance" | "visit" | "customer" | "message" | "media" | "account" | "alert";
  title: string;
  createdAt: string;
  status: "pending" | "awaiting-server" | "conflict";
};

export type TrackingPermissionAlert = {
  id: string;
  employeeId?: string;
  employeeName: string;
  createdAt: string;
  reason: "location-permission-denied";
  recipientRoles: Array<"manager" | "admin">;
  status: "awaiting-server" | "sent";
};

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

export type FieldTask = {
  id: string;
  title: string;
  description?: string;
  assignedToUserId: string;
  assignedToName?: string;
  assignedByUserId: string;
  assignedByName?: string;
  scheduledDate: string; // YYYY-MM-DD
  priority: TaskPriority;
  status: TaskStatus;
  locationLat?: string;
  locationLng?: string;
  locationAddress?: string;
  customerName?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DayGpsTimelinePoint = {
  id: string;
  timestamp: string;
  timeFormatted: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address?: string;
};

export type DayGpsHistory = {
  date: string;
  employeeId: string;
  employeeName: string;
  totalDistanceKm: number;
  pointsCount: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  points: DayGpsTimelinePoint[];
};

export type FieldWorkspace = {
  session: FieldSession | null;
  managedUsers: ManagedUser[];
  accountEvents: AccountLifecycleEvent[];
  attendance: AttendanceRecord[];
  tasks: FieldTask[];
  customers: Customer[];
  visits: Visit[];
  messages: ChatMessage[];
  routePoints: RoutePoint[];
  offlineQueue: OfflineOperation[];
  trackingPermissionAlerts: TrackingPermissionAlert[];
  trackingActive: boolean;
  trackingMode: "idle" | "foreground" | "background";
  notificationsEnabled: boolean;
};
