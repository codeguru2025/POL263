import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../src/context/AuthContext";
import { getTenantBranding, changePassword, type TenantBranding } from "../../src/api/auth";
import { submitFeedback } from "../../src/api/feedback";

export default function MoreScreen() {
  const { client, signOut } = useAuth();
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => { getTenantBranding().then(setBranding).catch(() => {}); }, []);

  const confirmSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: async () => { setSigningOut(true); await signOut(); } },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.profileCard}>
        <Text style={styles.name}>{client?.firstName} {client?.lastName}</Text>
        {client?.email ? <Text style={styles.sub}>{client.email}</Text> : null}
        {branding && <Text style={styles.sub}>{branding.name}</Text>}
      </View>

      <MenuRow label="Change password" onPress={() => setShowChangePw(true)} />
      <MenuRow label="Send feedback or complaint" onPress={() => setShowFeedback(true)} />
      <MenuRow label="Sign out" onPress={confirmSignOut} danger busy={signingOut} />

      <Modal visible={showChangePw} animationType="slide" onRequestClose={() => setShowChangePw(false)}>
        <ChangePasswordForm onDone={() => setShowChangePw(false)} onCancel={() => setShowChangePw(false)} />
      </Modal>
      <Modal visible={showFeedback} animationType="slide" onRequestClose={() => setShowFeedback(false)}>
        <FeedbackForm onDone={() => setShowFeedback(false)} onCancel={() => setShowFeedback(false)} />
      </Modal>
    </View>
  );
}

function MenuRow({ label, onPress, danger, busy }: { label: string; onPress: () => void; danger?: boolean; busy?: boolean }) {
  return (
    <Pressable style={styles.menuRow} onPress={onPress} disabled={busy}>
      {busy ? <ActivityIndicator size="small" /> : <Text style={[styles.menuRowText, danger && styles.menuRowDanger]}>{label}</Text>}
    </Pressable>
  );
}

function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (newPassword.length < 8) { setError("New password must be at least 8 characters"); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    setBusy(true);
    setError("");
    try {
      await changePassword(currentPassword, newPassword);
      onDone();
    } catch (err: any) {
      setError(err?.message || "Could not change password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onCancel}><Text style={styles.link}>Cancel</Text></Pressable>
        <Text style={styles.formTitle}>Change password</Text>
        <View style={{ width: 44 }} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
      <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
      <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Update password</Text>}
      </Pressable>
    </View>
  );
}

function FeedbackForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [type, setType] = useState<"feedback" | "complaint">("feedback");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!subject.trim() || !message.trim()) { setError("Subject and message are required"); return; }
    setBusy(true);
    setError("");
    try {
      await submitFeedback(type, subject.trim(), message.trim());
      onDone();
    } catch (err: any) {
      setError(err?.message || "Could not submit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formScreen}>
      <View style={styles.formHeader}>
        <Pressable onPress={onCancel}><Text style={styles.link}>Cancel</Text></Pressable>
        <Text style={styles.formTitle}>Feedback</Text>
        <View style={{ width: 44 }} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.chipRow}>
        <Pressable style={[styles.chip, type === "feedback" && styles.chipActive]} onPress={() => setType("feedback")}>
          <Text style={[styles.chipText, type === "feedback" && styles.chipTextActive]}>Feedback</Text>
        </Pressable>
        <Pressable style={[styles.chip, type === "complaint" && styles.chipActive]} onPress={() => setType("complaint")}>
          <Text style={[styles.chipText, type === "complaint" && styles.chipTextActive]}>Complaint</Text>
        </Pressable>
      </View>
      <Field label="Subject" value={subject} onChangeText={setSubject} />
      <Text style={styles.fieldLabel}>Message</Text>
      <TextInput style={[styles.input, styles.textArea]} value={message} onChangeText={setMessage} multiline />
      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit</Text>}
      </Pressable>
    </View>
  );
}

function Field(props: { label: string } & React.ComponentProps<typeof TextInput>) {
  const { label, ...rest } = props;
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6", padding: 16 },
  profileCard: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 16, marginBottom: 16 },
  name: { fontSize: 17, fontWeight: "700", color: "#14201F" },
  sub: { fontSize: 13, color: "#5B6D6B", marginTop: 4 },
  menuRow: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#DCE3E1", padding: 14, marginBottom: 8 },
  menuRowText: { fontSize: 14, fontWeight: "600", color: "#14201F" },
  menuRowDanger: { color: "#A33B3B" },
  formScreen: { flex: 1, backgroundColor: "#F4F6F6", padding: 20, paddingTop: 60 },
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#14201F" },
  link: { color: "#5B6D6B", fontSize: 15 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#5B6D6B", marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: "#FFFFFF" },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  button: { backgroundColor: "#0C6B62", borderRadius: 8, paddingVertical: 14, alignItems: "center", marginTop: 20 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  error: { color: "#A33B3B", backgroundColor: "#F8E9E9", padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, textAlign: "center" },
  chipRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: "#DCE3E1", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  chipActive: { backgroundColor: "#0C6B62", borderColor: "#0C6B62" },
  chipText: { fontSize: 13, fontWeight: "600", color: "#5B6D6B" },
  chipTextActive: { color: "#FFFFFF" },
});
