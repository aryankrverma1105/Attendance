import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatTime, useFieldData } from "@/lib/field-data";

export default function ChatScreen() {
  const router = useRouter();
  const { data, sendMessage } = useFieldData();
  const [message, setMessage] = useState("");
  const sortedMessages = useMemo(() => [...data.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [data.messages]);

  const submit = () => {
    if (!message.trim()) return;
    sendMessage(message);
    setMessage("");
  };

  return <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background" className="flex-1"><KeyboardAvoidingView behavior={Platform.select({ ios: "padding", default: undefined })} style={styles.flex}><View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back}><MaterialIcons color="#547087" name="arrow-back" size={22} /></Pressable><View style={styles.managerAvatar}><Text style={styles.managerInitial}>M</Text></View><View style={{ flex: 1 }}><Text style={styles.name}>Field manager</Text><View style={styles.onlineRow}><View style={styles.onlineDot} /><Text style={styles.onlineText}>Secure team channel</Text></View></View><Pressable style={styles.more}><MaterialIcons color="#547087" name="more-vert" size={21} /></Pressable></View><ScrollView contentContainerStyle={styles.messages} showsVerticalScrollIndicator={false}>{sortedMessages.length === 0 ? <Surface style={styles.empty}><MaterialIcons color="#8774C8" name="forum" size={31} /><Text style={styles.emptyTitle}>Start a manager conversation.</Text><Text style={styles.emptyBody}>Messages are saved locally and placed in the secure sync queue until the team service is configured.</Text></Surface> : sortedMessages.map((item) => <View key={item.id} style={[styles.bubbleRow, item.sender === "employee" && styles.employeeRow]}>{item.sender === "manager" ? <View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>M</Text></View> : null}<View style={[styles.bubble, item.sender === "employee" ? styles.employeeBubble : styles.managerBubble]}><Text style={[styles.messageText, item.sender === "employee" && styles.employeeMessageText]}>{item.text}</Text><View style={styles.metaRow}><Text style={[styles.messageMeta, item.sender === "employee" && styles.employeeMeta]}>{formatTime(item.createdAt)}</Text>{item.sender === "employee" ? <StatusChip label={item.delivery === "delivered" ? "Delivered" : "Queued"} tone={item.delivery === "delivered" ? "success" : "warning"} /> : null}</View></View></View>)}</ScrollView><View style={styles.composer}><TextInput multiline onChangeText={setMessage} placeholder="Message your manager…" placeholderTextColor="#7E96A9" style={styles.messageInput} value={message} /><Pressable onPress={submit} style={({ pressed }) => [styles.send, pressed && styles.pressed]}><MaterialIcons color="#17354A" name="send" size={20} /></Pressable></View></KeyboardAvoidingView></ScreenContainer>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: 16, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: "#E1EBF0", backgroundColor: "rgba(255,255,255,0.78)" },
  back: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EBF0", alignItems: "center", justifyContent: "center" },
  managerAvatar: { width: 39, height: 39, borderRadius: 14, backgroundColor: "#EEE9FF", alignItems: "center", justifyContent: "center" },
  managerInitial: { color: "#26143E", fontSize: 16, fontWeight: "900" },
  name: { color: "#17354A", fontSize: 14, fontWeight: "800" },
  onlineRow: { flexDirection: "row", gap: 5, alignItems: "center", marginTop: 3 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22B573" },
  onlineText: { color: "#7E96A9", fontSize: 11 },
  more: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  messages: { flexGrow: 1, padding: 16, gap: 12 },
  empty: { marginTop: 80, alignItems: "center", gap: 10, paddingVertical: 34 },
  emptyTitle: { color: "#17354A", fontSize: 16, fontWeight: "800" },
  emptyBody: { color: "#7E96A9", fontSize: 12, lineHeight: 18, textAlign: "center", maxWidth: 270 },
  bubbleRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  employeeRow: { justifyContent: "flex-end" },
  smallAvatar: { width: 27, height: 27, borderRadius: 9, backgroundColor: "#CDA5FF", justifyContent: "center", alignItems: "center" },
  smallAvatarText: { color: "#26143E", fontSize: 11, fontWeight: "900" },
  bubble: { maxWidth: "78%", borderRadius: 18, padding: 12, gap: 7 },
  managerBubble: { backgroundColor: "#FFFFFF", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: "#E1EBF0" },
  employeeBubble: { backgroundColor: "#DDF8F5", borderBottomRightRadius: 4 },
  messageText: { color: "#17354A", fontSize: 13, lineHeight: 18 },
  employeeMessageText: { color: "#17354A" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  messageMeta: { color: "#7E96A9", fontSize: 10 },
  employeeMeta: { color: "#117F7A" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 9, padding: 14, borderTopWidth: 1, borderTopColor: "#E1EBF0", backgroundColor: "rgba(255,255,255,0.88)" },
  messageInput: { flex: 1, minHeight: 45, maxHeight: 100, backgroundColor: "#F8FBFC", borderWidth: 1, borderColor: "#DDEAF0", borderRadius: 16, color: "#17354A", paddingHorizontal: 13, paddingVertical: 11, fontSize: 13 },
  send: { width: 45, height: 45, borderRadius: 15, backgroundColor: "#13C5B8", justifyContent: "center", alignItems: "center" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
});
