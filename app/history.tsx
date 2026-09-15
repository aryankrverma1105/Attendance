import { useState } from "react";
import { Alert, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { SectionHeading, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatDay, formatTime, useFieldData } from "@/lib/field-data";

const openCoordinateMap = (latitude?: number, longitude?: number, label?: string) => {
  if (latitude === undefined || longitude === undefined) {
    Alert.alert("Location Unavailable", "GPS coordinates are not available for this record.");
    return;
  }
  const url = Platform.select({
    ios: `maps://app?q=${encodeURIComponent(label || "Attendance Location")}&ll=${latitude},${longitude}`,
    android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(label || "Attendance Location")})`,
    default: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
  });
  Linking.openURL(url!).catch(() => {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);
  });
};

export default function AttendanceHistoryScreen() {
  const router = useRouter();
  const { data } = useFieldData();
  const [selectedPhoto, setSelectedPhoto] = useState<{
    uri: string;
    title: string;
    time?: string;
    lat?: number;
    lng?: number;
    accuracy?: number | null;
  } | null>(null);

  return (
    <ScreenContainer containerClassName="bg-background" className="flex-1">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <MaterialIcons color="#0B192C" name="arrow-back" size={22} />
          </Pressable>
          <View>
            <Text style={styles.title}>Attendance History</Text>
            <Text style={styles.subtitle}>Selfies, verified GPS coordinates, and sign-out records</Text>
          </View>
        </View>

        {data.attendance.length === 0 ? (
          <Surface style={styles.empty}>
            <MaterialIcons color="#D97706" name="history" size={32} />
            <Text style={styles.emptyTitle}>No attendance records logged yet.</Text>
            <Text style={styles.emptyBody}>
              Your check-in and check-out selfies and GPS coordinates will appear here.
            </Text>
          </Surface>
        ) : (
          <>
            <SectionHeading
              action={
                <Pressable
                  onPress={() => router.push("/location-history")}
                  style={styles.mapActionBtn}
                >
                  <MaterialIcons color="#D97706" name="map" size={14} />
                  <Text style={styles.mapActionText}>Full Route Map</Text>
                </Pressable>
              }
              title="Verified Shift Records"
            />
            <View style={styles.list}>
              {data.attendance.map((record) => (
                <Surface key={record.id} style={styles.recordCard}>
                  <View style={styles.recordTop}>
                    <View>
                      <Text style={styles.day}>{formatDay(record.checkInAt)}</Text>
                      <Text style={styles.time}>
                        {formatTime(record.checkInAt)} {record.checkOutAt ? `→ ${formatTime(record.checkOutAt)}` : "· In Progress"}
                      </Text>
                    </View>
                    <StatusChip
                      label={record.status === "verified" ? "GPS Verified" : "Review Location"}
                      tone={record.status === "verified" ? "success" : "warning"}
                    />
                  </View>

                  {/* Sign-In Evidence */}
                  <View style={styles.evidenceSection}>
                    <Text style={styles.evidenceSectionLabel}>SIGN-IN (CHECK-IN)</Text>
                    <View style={styles.evidenceRow}>
                      {record.checkInPhotoUri ? (
                        <Pressable
                          onPress={() =>
                            setSelectedPhoto({
                              uri: record.checkInPhotoUri!,
                              title: "Sign-In Selfie Proof",
                              time: formatTime(record.checkInAt),
                              lat: record.checkInLocation?.latitude,
                              lng: record.checkInLocation?.longitude,
                              accuracy: record.checkInLocation?.accuracy,
                            })
                          }
                          style={styles.photoThumbWrap}
                        >
                          <Image source={{ uri: record.checkInPhotoUri }} style={styles.photoThumb} />
                          <View style={styles.zoomBadge}>
                            <MaterialIcons color="#FFFFFF" name="zoom-in" size={14} />
                          </View>
                        </Pressable>
                      ) : (
                        <View style={styles.photoFallback}>
                          <MaterialIcons color="#94A3B8" name="no-photography" size={20} />
                        </View>
                      )}

                      <View style={styles.evidenceInfo}>
                        <View style={styles.evidenceTimeRow}>
                          <MaterialIcons color="#10B981" name="login" size={14} />
                          <Text style={styles.evidenceTimeText}>{formatTime(record.checkInAt)}</Text>
                        </View>
                        <Text style={styles.evidenceCoords}>
                          {record.checkInLocation
                            ? `📍 ${record.checkInLocation.latitude.toFixed(5)}, ${record.checkInLocation.longitude.toFixed(5)}`
                            : "GPS logged"}
                        </Text>
                        <Text style={styles.evidenceAccuracy}>
                          Accuracy: {record.checkInLocation?.accuracy !== null && record.checkInLocation?.accuracy !== undefined ? `±${Math.round(record.checkInLocation.accuracy)} m` : "Standard"}
                        </Text>

                        {record.checkInLocation ? (
                          <Pressable
                            onPress={() =>
                              openCoordinateMap(
                                record.checkInLocation?.latitude,
                                record.checkInLocation?.longitude,
                                "Check-in Location"
                              )
                            }
                            style={styles.mapBtn}
                          >
                            <MaterialIcons color="#2563EB" name="map" size={13} />
                            <Text style={styles.mapBtnText}>View on Map</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  {/* Sign-Out Evidence */}
                  <View style={[styles.evidenceSection, { borderTopWidth: 1, borderTopColor: "#F1F5F9", paddingTop: 10 }]}>
                    <Text style={styles.evidenceSectionLabel}>SIGN-OUT (CHECK-OUT)</Text>
                    {record.checkOutAt ? (
                      <View style={styles.evidenceRow}>
                        {record.checkOutPhotoUri ? (
                          <Pressable
                            onPress={() =>
                              setSelectedPhoto({
                                uri: record.checkOutPhotoUri!,
                                title: "Sign-Out Selfie Proof",
                                time: formatTime(record.checkOutAt),
                                lat: record.checkOutLocation?.latitude,
                                lng: record.checkOutLocation?.longitude,
                                accuracy: record.checkOutLocation?.accuracy,
                              })
                            }
                            style={styles.photoThumbWrap}
                          >
                            <Image source={{ uri: record.checkOutPhotoUri }} style={styles.photoThumb} />
                            <View style={styles.zoomBadge}>
                              <MaterialIcons color="#FFFFFF" name="zoom-in" size={14} />
                            </View>
                          </Pressable>
                        ) : (
                          <View style={styles.photoFallback}>
                            <MaterialIcons color="#94A3B8" name="no-photography" size={20} />
                          </View>
                        )}

                        <View style={styles.evidenceInfo}>
                          <View style={styles.evidenceTimeRow}>
                            <MaterialIcons color="#DC2626" name="logout" size={14} />
                            <Text style={styles.evidenceTimeText}>{formatTime(record.checkOutAt)}</Text>
                          </View>
                          <Text style={styles.evidenceCoords}>
                            {record.checkOutLocation
                              ? `📍 ${record.checkOutLocation.latitude.toFixed(5)}, ${record.checkOutLocation.longitude.toFixed(5)}`
                              : "GPS logged"}
                          </Text>
                          <Text style={styles.evidenceAccuracy}>
                            Accuracy: {record.checkOutLocation?.accuracy !== null && record.checkOutLocation?.accuracy !== undefined ? `±${Math.round(record.checkOutLocation.accuracy)} m` : "Standard"}
                          </Text>

                          {record.checkOutLocation ? (
                            <Pressable
                              onPress={() =>
                                openCoordinateMap(
                                  record.checkOutLocation?.latitude,
                                  record.checkOutLocation?.longitude,
                                  "Check-out Location"
                                )
                              }
                              style={styles.mapBtn}
                            >
                              <MaterialIcons color="#2563EB" name="map" size={13} />
                              <Text style={styles.mapBtnText}>View on Map</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : (
                      <View style={styles.activeShiftBanner}>
                        <MaterialIcons color="#D97706" name="pending" size={16} />
                        <Text style={styles.activeShiftText}>Currently active on shift (not signed out yet)</Text>
                      </View>
                    )}
                  </View>
                </Surface>
              ))}
            </View>
          </>
        )}

        {/* Full-Screen Selfie Viewer Modal */}
        <Modal
          animationType="fade"
          onRequestClose={() => setSelectedPhoto(null)}
          transparent
          visible={Boolean(selectedPhoto)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{selectedPhoto?.title}</Text>
                  {selectedPhoto?.time ? (
                    <Text style={styles.modalTime}>{selectedPhoto.time}</Text>
                  ) : null}
                </View>
                <Pressable onPress={() => setSelectedPhoto(null)} style={styles.modalCloseBtn}>
                  <MaterialIcons color="#F8FAFC" name="close" size={22} />
                </Pressable>
              </View>

              {selectedPhoto?.uri ? (
                <Image
                  resizeMode="contain"
                  source={{ uri: selectedPhoto.uri }}
                  style={styles.modalImage}
                />
              ) : null}

              {selectedPhoto?.lat && selectedPhoto?.lng ? (
                <View style={styles.modalFooter}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalCoords}>
                      📍 {selectedPhoto.lat.toFixed(6)}, {selectedPhoto.lng.toFixed(6)}
                    </Text>
                    <Text style={styles.modalAccuracy}>
                      Accuracy: {selectedPhoto.accuracy ? `±${Math.round(selectedPhoto.accuracy)} m` : "Verified"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() =>
                      openCoordinateMap(selectedPhoto.lat, selectedPhoto.lng, selectedPhoto.title)
                    }
                    style={styles.modalMapBtn}
                  >
                    <MaterialIcons color="#FFFFFF" name="directions" size={16} />
                    <Text style={styles.modalMapBtnText}>Open in Maps</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </Modal>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    justifyContent: "center",
    alignItems: "center",
  },
  title: { color: "#0B192C", fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  subtitle: { color: "#64748B", fontSize: 11, marginTop: 2 },
  mapActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  mapActionText: { color: "#D97706", fontSize: 12, fontWeight: "800" },
  empty: { alignItems: "center", paddingVertical: 42, gap: 10 },
  emptyTitle: { color: "#0B192C", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#64748B", lineHeight: 18, fontSize: 12, textAlign: "center", maxWidth: 280 },
  list: { gap: 12 },
  recordCard: { gap: 12, padding: 16 },
  recordTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  day: { color: "#0B192C", fontSize: 15, fontWeight: "800" },
  time: { color: "#64748B", fontSize: 12, marginTop: 3 },
  evidenceSection: { gap: 8, paddingTop: 4 },
  evidenceSectionLabel: { color: "#D97706", fontSize: 9, letterSpacing: 1, fontWeight: "900" },
  evidenceRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  photoThumbWrap: {
    width: 60,
    height: 60,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#F1F5F9",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    position: "relative",
  },
  photoThumb: { width: "100%", height: "100%" },
  zoomBadge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    borderRadius: 8,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  photoFallback: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  evidenceInfo: { flex: 1, gap: 2 },
  evidenceTimeRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  evidenceTimeText: { color: "#0B192C", fontSize: 13, fontWeight: "800" },
  evidenceCoords: { color: "#334155", fontSize: 11, fontWeight: "600" },
  evidenceAccuracy: { color: "#64748B", fontSize: 10 },
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  mapBtnText: { color: "#2563EB", fontSize: 11, fontWeight: "800" },
  activeShiftBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF3C7",
    padding: 8,
    borderRadius: 10,
  },
  activeShiftText: { color: "#92400E", fontSize: 11, fontWeight: "600", flex: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContent: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#0F172A",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  modalTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  modalTime: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalImage: { width: "100%", height: 320, backgroundColor: "#000000" },
  modalFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.1)",
  },
  modalCoords: { color: "#F8FAFC", fontSize: 12, fontWeight: "700" },
  modalAccuracy: { color: "#94A3B8", fontSize: 11, marginTop: 1 },
  modalMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2563EB",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  modalMapBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
});
