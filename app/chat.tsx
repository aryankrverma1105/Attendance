import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FieldButton, StatusChip, Surface } from "@/components/field-ui";
import { ScreenContainer } from "@/components/screen-container";
import { formatTime, useFieldData } from "@/lib/field-data";
import { trpc } from "@/lib/trpc";
import { enqueueOperation } from "@/lib/offline-sync";

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ targetUserId?: string }>();
  const { data, sendMessage } = useFieldData();
  const [message, setMessage] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);

  const actorRole = data.session?.role;
  const isEmployee = actorRole === "employee";

  // Resolve real counterpart:
  // - Employee: assigned manager ID (fallback 1)
  // - Manager/Admin: selected employee ID from params
  const counterpartUserId = useMemo(() => {
    if (params.targetUserId) {
      const p = parseInt(params.targetUserId, 10);
      if (!isNaN(p) && p > 0) return p;
    }
    if (isEmployee && data.session?.managerId) {
      const m = parseInt(data.session.managerId, 10);
      if (!isNaN(m) && m > 0) return m;
    }
    return 1;
  }, [params.targetUserId, isEmployee, data.session?.managerId]);

  // Resolve or create channel on backend
  const getChannelMutation = trpc.chat.getOrCreateChannel.useMutation();
  const sendMessageMutation = trpc.chat.sendMessage.useMutation();

  useEffect(() => {
    getChannelMutation
      .mutateAsync({ targetUserId: counterpartUserId })
      .then((ch) => {
        if (ch?.id) setChannelId(ch.id);
      })
      .catch((err) => {
        console.warn("[Chat] Channel resolution warning:", err);
      });
  }, [counterpartUserId]);

  const messagesQuery = trpc.chat.getMessages.useQuery(
    { channelId: channelId || "default-chan" },
    { enabled: !!channelId, refetchInterval: 5000 }
  );

  // Merge server messages with sender mapping based strictly on server user id
  const sortedMessages = useMemo(() => {
    if (messagesQuery.data && messagesQuery.data.length > 0) {
      return [...messagesQuery.data].map((m) => {
        const isMe = String(m.senderUserId) === String(data.session?.id);
        return {
          id: m.id,
          text: m.message,
          isMe,
          sender: isMe ? "self" : "counterpart",
          createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
          delivery: (m.status === "delivered" || m.status === "read" ? "delivered" : "pending") as "delivered" | "pending",
        };
      });
    }
    return [...data.messages].map((m) => ({
      ...m,
      isMe: m.sender === "employee",
    })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [messagesQuery.data, data.messages, data.session?.id]);

  const submit = async () => {
    const text = message.trim();
    if (!text) return;

    setMessage("");
    // Optimistic UI update
    sendMessage(text);

    if (channelId) {
      try {
        await sendMessageMutation.mutateAsync({ channelId, message: text });
        await messagesQuery.refetch();
      } catch (err) {
        console.warn("[Chat] Message send failed, queued offline:", err);
        await enqueueOperation("CHAT_MESSAGE", { channelId, text }, "high");
      }
    } else {
      await enqueueOperation("CHAT_MESSAGE", { text }, "normal");
    }
  };

  const headerTitle = isEmployee ? "Field Manager" : `Team Member #${counterpartUserId}`;

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background" className="flex-1">
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", default: undefined })} style={styles.flex}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <MaterialIcons color="#547087" name="arrow-back" size={22} />
          </Pressable>
          <View style={styles.managerAvatar}>
            <Text style={styles.managerInitial}>{isEmployee ? "M" : "E"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{headerTitle}</Text>
            <View style={styles.onlineRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>Secure verified channel</Text>
            </View>
          </View>
          <Pressable style={styles.more}>
            <MaterialIcons color="#547087" name="more-vert" size={21} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.messages} showsVerticalScrollIndicator={false}>
          {sortedMessages.length === 0 ? (
            <Surface style={styles.empty}>
              <MaterialIcons color="#8774C8" name="forum" size={31} />
              <Text style={styles.emptyTitle}>Start a team conversation.</Text>
              <Text style={styles.emptyBody}>
                Messages are synchronized directly with the secure field server.
              </Text>
            </Surface>
          ) : (
            sortedMessages.map((item) => (
              <View key={item.id} style={[styles.bubbleRow, item.isMe && styles.employeeRow]}>
                {!item.isMe ? (
                  <View style={styles.smallAvatar}>
                    <Text style={styles.smallAvatarText}>{isEmployee ? "M" : "E"}</Text>
                  </View>
                ) : null}
                <View style={[styles.bubble, item.isMe ? styles.employeeBubble : styles.managerBubble]}>
                  <Text style={[styles.messageText, item.isMe && styles.employeeMessageText]}>{item.text}</Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.messageMeta, item.isMe && styles.employeeMeta]}>{formatTime(item.createdAt)}</Text>
                    {item.isMe ? (
                      <StatusChip label={item.delivery === "delivered" ? "Delivered" : "Queued"} tone={item.delivery === "delivered" ? "success" : "warning"} />
                    ) : null}
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            multiline
            onChangeText={setMessage}
            placeholder={isEmployee ? "Message your manager…" : "Message team member…"}
            placeholderTextColor="#7E96A9"
            style={styles.messageInput}
            value={message}
          />
          <Pressable onPress={submit} style={({ pressed }) => [styles.send, pressed && styles.pressed]}>
            <MaterialIcons color="#17354A" name="send" size={20} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
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
