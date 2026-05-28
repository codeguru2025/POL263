import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList,
  RefreshControl, ActivityIndicator, Image, Alert, TextInput,
  Modal, Linking, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "../context/AuthContext";
import { useNetwork } from "../context/NetworkContext";
import { colors, spacing, fontSize } from "../theme";
import { API_BASE } from "../config";
import { clientSync, loadClientCache, queuePayment, getQueuedPayments } from "../sync/engine";

interface Policy {
  id: string; policyNumber: string; status: string; premiumAmount: string;
  currency: string; paymentSchedule: string; effectiveDate?: string;
  inceptionDate?: string; productName?: string; totalPaid?: string;
  totalDue?: string; balance?: string; periodsElapsed?: number;
}
interface Dependent {
  id: string; firstName: string; lastName: string; relationship: string;
  dateOfBirth?: string; nationalId?: string; gender?: string;
}
interface Notif {
  id: string; title: string; message: string; type: string;
  isRead: boolean; createdAt: string;
}
interface ClaimItem {
  id: string; claimNumber: string; status: string; claimType: string;
  deceasedName?: string; deceasedRelationship?: string; createdAt: string;
}
interface Receipt { id: string; receiptNumber: string; amount: string; currency: string; createdAt: string; pdfStorageKey?: string; issuedAt?: string; }
interface FeedbackItem { id: string; type: string; subject: string; status: string; createdAt: string; }
interface QueuedPayment { id: number; policy_id: string; policy_number: string | null; amount: string; currency: string; method: string; phone: string; status: string; error: string | null; created_at: string; }

type Tab = "policies" | "payments" | "claims" | "documents" | "feedback" | "dependents" | "notifications" | "profile";

const STATUS_COLORS: Record<string, string> = {
  active: "#16a34a", pending: "#d97706", lapsed: "#dc2626",
  cancelled: "#6b7280", claimed: "#7c3aed", grace: "#f59e0b",
};

// ── helpers ──────────────────────────────────────────────────────────
const api = (path: string, opts?: RequestInit) =>
  fetch(`${API_BASE}${path}`, { credentials: "include", ...opts });

function Empty({ emoji, title, sub }: { emoji: string; title: string; sub: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyEmoji}>{emoji}</Text>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptySub}>{sub}</Text>
    </View>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[s.badge, { backgroundColor: color + "22" }]}>
      <Text style={[s.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[s.card, style]}>{children}</View>;
}

// ── main component ────────────────────────────────────────────────────
export default function ClientPortalScreen() {
  const { user, logout } = useAuth();
  const { isOnline } = useNetwork();
  const [tab, setTab] = useState<Tab>("policies");
  const [refreshing, setRefreshing] = useState(false);

  // data
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [queuedPayments, setQueuedPayments] = useState<QueuedPayment[]>([]);
  const [cacheDate, setCacheDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // payment flow
  const [payPolicy, setPayPolicy] = useState<Policy | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payPhone, setPayPhone] = useState("");
  const [payMethod, setPayMethod] = useState("ecocash");
  const [paying, setPaying] = useState(false);
  const [payStatus, setPayStatus] = useState<"idle" | "polling" | "paid" | "failed">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // claim modal
  const [claimPolicy, setClaimPolicy] = useState("");
  const [claimType, setClaimType] = useState("");
  const [claimDeceased, setClaimDeceased] = useState("");
  const [claimRel, setClaimRel] = useState("");
  const [claimDod, setClaimDod] = useState("");
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [submittingClaim, setSubmittingClaim] = useState(false);

  // feedback modal
  const [fbType, setFbType] = useState<"feedback" | "complaint">("feedback");
  const [fbSubject, setFbSubject] = useState("");
  const [fbMessage, setFbMessage] = useState("");
  const [showFbModal, setShowFbModal] = useState(false);
  const [submittingFb, setSubmittingFb] = useState(false);

  // dep modal
  const [showDepModal, setShowDepModal] = useState(false);
  const [depFirst, setDepFirst] = useState("");
  const [depLast, setDepLast] = useState("");
  const [depRel, setDepRel] = useState("");
  const [depDob, setDepDob] = useState("");
  const [addingDep, setAddingDep] = useState(false);

  // password change
  const [showPwModal, setShowPwModal] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const loadQueued = useCallback(async () => {
    setQueuedPayments(await getQueuedPayments());
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      if (!isOnline) {
        const cache = await loadClientCache();
        setPolicies(cache.policies);
        setReceipts(cache.receipts);
        setClaims(cache.claims);
        setDependents(cache.dependents);
        setNotifs(cache.notifications);
        setFeedback(cache.feedback);
        setCacheDate(cache.lastSync);
        return;
      }
      const results = await Promise.allSettled([
        api("/api/client-auth/policies"),
        api("/api/client-auth/receipts"),
        api("/api/client-auth/claims"),
        api("/api/client-auth/dependents"),
        api("/api/client-auth/notifications"),
        api("/api/client-auth/feedback"),
      ]);
      const [polR, recR, claimR, depR, notifR, fbR] = results;
      if (polR.status === "fulfilled" && polR.value.ok) setPolicies(await polR.value.json());
      if (recR.status === "fulfilled" && recR.value.ok) setReceipts(await recR.value.json());
      if (claimR.status === "fulfilled" && claimR.value.ok) setClaims(await claimR.value.json());
      if (depR.status === "fulfilled" && depR.value.ok) setDependents(await depR.value.json());
      if (notifR.status === "fulfilled" && notifR.value.ok) {
        const raw = await notifR.value.json();
        setNotifs(Array.isArray(raw) ? raw : (raw?.notifications ?? []));
      }
      if (fbR.status === "fulfilled" && fbR.value.ok) setFeedback(await fbR.value.json());
      clientSync().catch(() => {});
      setCacheDate(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { fetchAll(); loadQueued(); }, [fetchAll, loadQueued]);

  const onRefresh = async () => { setRefreshing(true); await fetchAll(); await loadQueued(); setRefreshing(false); };

  const handleLogout = () =>
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);

  // ── In-app document / receipt viewer ─────────────────────────
  const viewDocument = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        toolbarColor: colors.primary,
        controlsColor: "#ffffff",
      });
    } catch {
      Alert.alert("Cannot Open", "Could not open document. Check your connection and try again.");
    }
  };

  // ── Paynow payment ────────────────────────────────────────────
  const startPayment = async () => {
    if (!payPolicy || !payAmount || !payPhone) {
      Alert.alert("Error", "Fill in all payment fields"); return;
    }
    if (!isOnline) {
      await queuePayment({
        policyId: payPolicy.id, policyNumber: payPolicy.policyNumber,
        amount: payAmount, currency: payPolicy.currency,
        method: payMethod, phone: payPhone,
      });
      await loadQueued();
      setPayPolicy(null); setPayAmount(""); setPayPhone("");
      Alert.alert("📶 Queued", `Payment of ${payPolicy.currency} ${payAmount} for ${payPolicy.policyNumber} has been queued and will be sent automatically when you reconnect.`);
      return;
    }
    setPaying(true); setPayStatus("idle");
    try {
      const key = `client-${payPolicy.id}-${Date.now()}`;
      const intentRes = await api("/api/client-auth/payment-intents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: payPolicy.id, amount: payAmount, purpose: "premium", idempotencyKey: key }),
      });
      if (!intentRes.ok) { const e = await intentRes.json().catch(() => ({})); throw new Error(e.message || "Could not create payment"); }
      const { intent } = await intentRes.json();
      const initRes = await api(`/api/client-auth/payment-intents/${intent.id}/initiate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: payMethod, payerPhone: payPhone }),
      });
      if (!initRes.ok) { const e = await initRes.json().catch(() => ({})); throw new Error(e.message || "Could not start payment"); }
      setPayStatus("polling");
      pollRef.current = setInterval(async () => {
        try {
          const sr = await api(`/api/client-auth/payment-intents/${intent.id}/status`);
          if (!sr.ok) return;
          const { paid, status } = await sr.json();
          if (paid || status === "cleared") {
            clearInterval(pollRef.current!); setPayStatus("paid");
            Alert.alert("✅ Payment Received", "Your payment has been confirmed!");
            setPayPolicy(null); await fetchAll();
          } else if (status === "failed" || status === "cancelled") {
            clearInterval(pollRef.current!); setPayStatus("failed");
          }
        } catch {}
      }, 4000);
      setTimeout(() => { if (pollRef.current) { clearInterval(pollRef.current); if (payStatus === "polling") setPayStatus("failed"); } }, 5 * 60 * 1000);
    } catch (e: any) {
      Alert.alert("Payment Error", e.message || "Failed");
    } finally { setPaying(false); }
  };

  // ── Submit claim ──────────────────────────────────────────────
  const submitClaim = async () => {
    if (!claimPolicy || !claimType) { Alert.alert("Error", "Select policy and claim type"); return; }
    setSubmittingClaim(true);
    try {
      const r = await api("/api/client-auth/claims", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: claimPolicy, claimType, deceasedName: claimDeceased || undefined, deceasedRelationship: claimRel || undefined, dateOfDeath: claimDod || undefined }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || "Failed"); }
      Alert.alert("✅ Claim Submitted", "We will review your claim and be in touch.");
      setShowClaimModal(false); setClaimPolicy(""); setClaimType(""); setClaimDeceased(""); setClaimRel(""); setClaimDod("");
      await fetchAll();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setSubmittingClaim(false); }
  };

  // ── Submit feedback ───────────────────────────────────────────
  const submitFeedback = async () => {
    if (!fbSubject.trim() || !fbMessage.trim()) { Alert.alert("Error", "Fill in subject and message"); return; }
    setSubmittingFb(true);
    try {
      const r = await api("/api/client-auth/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: fbType, subject: fbSubject, message: fbMessage }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || "Failed"); }
      Alert.alert("✅ Submitted", "Thank you for your feedback.");
      setShowFbModal(false); setFbSubject(""); setFbMessage("");
      await fetchAll();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setSubmittingFb(false); }
  };

  // ── Add dependent ─────────────────────────────────────────────
  const addDependent = async () => {
    if (!depFirst.trim() || !depLast.trim() || !depRel.trim()) { Alert.alert("Error", "First name, last name and relationship required"); return; }
    setAddingDep(true);
    try {
      const r = await api("/api/client-auth/dependents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: depFirst, lastName: depLast, relationship: depRel, dateOfBirth: depDob || undefined }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || "Failed"); }
      Alert.alert("✅ Dependent Added");
      setShowDepModal(false); setDepFirst(""); setDepLast(""); setDepRel(""); setDepDob("");
      const dr = await api("/api/client-auth/dependents"); if (dr.ok) setDependents(await dr.json());
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setAddingDep(false); }
  };

  const removeDependent = (dep: Dependent) =>
    Alert.alert("Remove Dependent", `Remove ${dep.firstName} ${dep.lastName}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        try {
          const r = await api(`/api/client-auth/dependents/${dep.id}`, { method: "DELETE" });
          if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || "Failed"); }
          setDependents(prev => prev.filter(d => d.id !== dep.id));
        } catch (e: any) { Alert.alert("Error", e.message || "Could not remove dependent"); }
      }},
    ]);

  // ── Change password ───────────────────────────────────────────
  const changePassword = async () => {
    if (!curPw || !newPw) { Alert.alert("Error", "Both fields required"); return; }
    if (newPw.length < 8) { Alert.alert("Error", "New password must be at least 8 characters"); return; }
    setSavingPw(true);
    try {
      const r = await api("/api/client-auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || "Failed"); }
      Alert.alert("✅ Password Changed");
      setShowPwModal(false); setCurPw(""); setNewPw("");
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setSavingPw(false); }
  };

  // ── Mark notification read ─────────────────────────────────────
  const markRead = async (id: string) => {
    await api(`/api/client-auth/notifications/${id}/read`, { method: "PATCH" });
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };
  const markAllRead = async () => {
    await api("/api/client-auth/notifications/mark-all-read", { method: "PATCH" });
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
  };


  const unreadCount = notifs.filter(n => !n.isRead).length;

  type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
  const TABS: { key: Tab; icon: IoniconName; activeIcon: IoniconName; label: string }[] = [
    { key: "policies",      icon: "document-text-outline",  activeIcon: "document-text",  label: "Policies" },
    { key: "payments",      icon: "card-outline",           activeIcon: "card",           label: "Payments" },
    { key: "claims",        icon: "medkit-outline",         activeIcon: "medkit",         label: "Claims" },
    { key: "documents",     icon: "folder-outline",         activeIcon: "folder",         label: "Docs" },
    { key: "feedback",      icon: "chatbubble-outline",     activeIcon: "chatbubble",     label: "Feedback" },
    { key: "dependents",    icon: "people-outline",         activeIcon: "people",         label: "Family" },
    { key: "notifications", icon: "notifications-outline",  activeIcon: "notifications",  label: "Alerts" },
    { key: "profile",       icon: "person-outline",         activeIcon: "person",         label: "Profile" },
  ];

  // ── Render tabs ───────────────────────────────────────────────
  const renderPolicies = () => (
    <>
      {policies.length === 0
        ? <Empty emoji="📋" title="No policies" sub="Your policies will appear here." />
        : policies.map(p => (
          <Card key={p.id}>
            <View style={s.row}>
              <Text style={s.polNum}>{p.policyNumber}</Text>
              <Badge text={p.status.toUpperCase()} color={STATUS_COLORS[p.status] || "#6b7280"} />
            </View>
            {p.productName && <Text style={s.productName}>{p.productName}</Text>}
            <View style={s.metaRow}>
              <View style={s.metaCol}><Text style={s.metaLabel}>Premium</Text><Text style={s.metaVal}>{p.currency} {parseFloat(p.premiumAmount || "0").toLocaleString()}</Text></View>
              <View style={s.metaCol}><Text style={s.metaLabel}>Schedule</Text><Text style={s.metaVal}>{p.paymentSchedule}</Text></View>
              {p.effectiveDate && <View style={s.metaCol}><Text style={s.metaLabel}>Effective</Text><Text style={s.metaVal}>{new Date(p.effectiveDate).toLocaleDateString()}</Text></View>}
            </View>
            {p.totalPaid && <Text style={s.creditLine}>Paid: {p.currency} {parseFloat(p.totalPaid).toLocaleString()}  •  Due: {p.currency} {parseFloat(p.totalDue || "0").toLocaleString()}</Text>}
            <TouchableOpacity style={s.payBtn} onPress={() => { setPayPolicy(p); setPayAmount(p.premiumAmount); }}>
              <Text style={s.payBtnText}>💳 Pay Premium</Text>
            </TouchableOpacity>
          </Card>
        ))}
    </>
  );

  const renderPayments = () => (
    <>
      {queuedPayments.filter(q => q.status === "pending" || q.status === "failed").length > 0 && (
        <Card style={{ borderColor: "#d97706", backgroundColor: "#fffbeb" }}>
          <View style={s.row}>
            <Ionicons name="time-outline" size={18} color="#d97706" />
            <Text style={[s.polNum, { color: "#92400e", marginLeft: 8 }]}>Queued Payments</Text>
          </View>
          {queuedPayments.filter(q => q.status === "pending" || q.status === "failed").map(q => (
            <View key={q.id} style={{ marginTop: spacing.xs }}>
              <Text style={s.productName}>{q.policy_number || q.policy_id} — {q.currency} {q.amount} via {q.method}</Text>
              <Text style={[s.dateText, { color: q.status === "failed" ? colors.danger : "#d97706" }]}>
                {q.status === "failed" ? `⚠️ Failed: ${q.error}` : "Will send when online…"}
              </Text>
            </View>
          ))}
          {!isOnline && <Text style={{ fontSize: fontSize.xs, color: "#92400e", marginTop: spacing.sm }}>Reconnect to process queued payments</Text>}
        </Card>
      )}
      {receipts.length === 0
        ? <Empty emoji="💳" title="No payment records" sub="Receipts will appear here after payments." />
        : receipts.map(r => (
          <Card key={r.id}>
            <View style={s.row}>
              <Text style={s.polNum}>{r.receiptNumber}</Text>
              <View style={{ flexDirection: "row", gap: spacing.xs }}>
                <TouchableOpacity onPress={() => viewDocument(`${API_BASE}/api/client-auth/receipts/${r.id}/download?inline=1`)} style={s.viewBtn}>
                  <Ionicons name="eye-outline" size={14} color={colors.primary} />
                  <Text style={s.viewBtnText}>View</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Linking.openURL(`${API_BASE}/api/client-auth/receipts/${r.id}/download`)} style={s.dlBtn}>
                  <Ionicons name="download-outline" size={14} color={colors.primary} />
                  <Text style={s.dlBtnText}>PDF</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={s.metaRow}>
              <View style={s.metaCol}><Text style={s.metaLabel}>Amount</Text><Text style={s.metaVal}>{r.currency} {parseFloat(r.amount).toLocaleString()}</Text></View>
              <View style={s.metaCol}><Text style={s.metaLabel}>Date</Text><Text style={s.metaVal}>{new Date(r.issuedAt || r.createdAt).toLocaleDateString()}</Text></View>
            </View>
          </Card>
        ))}
    </>
  );

  const renderClaims = () => (
    <>
      {isOnline && (
        <TouchableOpacity style={s.actionBtn} onPress={() => setShowClaimModal(true)}>
          <Text style={s.actionBtnText}>+ Submit New Claim</Text>
        </TouchableOpacity>
      )}
      {claims.length === 0
        ? <Empty emoji="🏥" title="No claims" sub="Submit a claim to get started." />
        : claims.map(c => (
          <Card key={c.id}>
            <View style={s.row}>
              <Text style={s.polNum}>{c.claimNumber}</Text>
              <Badge text={c.status.replace("_", " ").toUpperCase()} color={c.status === "approved" ? colors.success : c.status === "rejected" ? colors.danger : "#d97706"} />
            </View>
            <Text style={s.productName}>Type: {c.claimType}</Text>
            {c.deceasedName && <Text style={s.productName}>Deceased: {c.deceasedName} ({c.deceasedRelationship})</Text>}
            <Text style={s.dateText}>{new Date(c.createdAt).toLocaleDateString()}</Text>
          </Card>
        ))}
    </>
  );

  const renderDocuments = () => (
    <>
      {!isOnline && (
        <View style={[s.offlineBanner, { marginBottom: spacing.md }]}>
          <Text style={s.offlineText}>📶 Offline — documents require connectivity to view or download</Text>
        </View>
      )}
      {policies.length === 0
        ? <Empty emoji="📄" title="No documents" sub="Policy documents will appear here." />
        : policies.map(p => (
          <Card key={p.id}>
            <View style={{ marginBottom: spacing.sm }}>
              <Text style={s.polNum}>{p.policyNumber}</Text>
              {p.productName && <Text style={s.productName}>{p.productName}</Text>}
              <Badge text={p.status.toUpperCase()} color={STATUS_COLORS[p.status] || "#6b7280"} />
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <TouchableOpacity
                style={[s.viewBtn, { flex: 1, justifyContent: "center" }]}
                onPress={() => viewDocument(`${API_BASE}/api/client-auth/policies/${p.id}/document`)}
                disabled={!isOnline}
              >
                <Ionicons name="eye-outline" size={16} color={isOnline ? colors.primary : colors.textMuted} />
                <Text style={[s.viewBtnText, !isOnline && { color: colors.textMuted }]}>View</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.dlBtn, { flex: 1, justifyContent: "center" }]}
                onPress={() => Linking.openURL(`${API_BASE}/api/client-auth/policies/${p.id}/document?download=1`)}
                disabled={!isOnline}
              >
                <Ionicons name="download-outline" size={16} color={isOnline ? colors.primary : colors.textMuted} />
                <Text style={[s.dlBtnText, !isOnline && { color: colors.textMuted }]}>Download</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))}
    </>
  );

  const renderFeedback = () => (
    <>
      {isOnline && (
        <TouchableOpacity style={s.actionBtn} onPress={() => setShowFbModal(true)}>
          <Text style={s.actionBtnText}>+ Submit Feedback / Complaint</Text>
        </TouchableOpacity>
      )}
      {feedback.length === 0
        ? <Empty emoji="💬" title="No feedback" sub="Your submitted feedback will appear here." />
        : feedback.map(fb => (
          <Card key={fb.id}>
            <View style={s.row}>
              <Badge text={fb.type.toUpperCase()} color={fb.type === "complaint" ? colors.danger : colors.primary} />
              <Badge text={fb.status.toUpperCase()} color={fb.status === "resolved" ? colors.success : "#d97706"} />
            </View>
            <Text style={[s.polNum, { marginTop: spacing.xs }]}>{fb.subject}</Text>
            <Text style={s.dateText}>{new Date(fb.createdAt).toLocaleDateString()}</Text>
          </Card>
        ))}
    </>
  );

  const renderDependents = () => (
    <>
      {isOnline && (
        <TouchableOpacity style={s.actionBtn} onPress={() => setShowDepModal(true)}>
          <Text style={s.actionBtnText}>+ Add Dependent</Text>
        </TouchableOpacity>
      )}
      {dependents.length === 0
        ? <Empty emoji="👨‍👩‍👧" title="No dependents" sub="Add family members covered under your policy." />
        : dependents.map(d => (
          <Card key={d.id}>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.polNum}>{d.firstName} {d.lastName}</Text>
                <Text style={s.productName}>{d.relationship}{d.dateOfBirth ? ` • Born ${new Date(d.dateOfBirth).toLocaleDateString()}` : ""}</Text>
                {d.nationalId && <Text style={s.dateText}>ID: {d.nationalId}</Text>}
              </View>
              {isOnline && (
                <TouchableOpacity onPress={() => removeDependent(d)} style={s.removeBtn}>
                  <Text style={s.removeBtnText}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          </Card>
        ))}
    </>
  );

  const renderNotifications = () => (
    <>
      {unreadCount > 0 && isOnline && (
        <TouchableOpacity style={s.markAllBtn} onPress={markAllRead}>
          <Text style={s.markAllText}>Mark all as read</Text>
        </TouchableOpacity>
      )}
      {notifs.length === 0
        ? <Empty emoji="🔔" title="All clear!" sub="No notifications at this time." />
        : notifs.map(n => (
          <TouchableOpacity key={n.id} style={[s.card, !n.isRead && s.cardUnread]} onPress={() => !n.isRead && markRead(n.id)} activeOpacity={n.isRead ? 1 : 0.7}>
            <View style={s.row}>
              <Text style={s.notifTitle}>{n.title}</Text>
              {!n.isRead && <View style={s.unreadDot} />}
            </View>
            <Text style={s.notifMsg}>{n.message}</Text>
            <Text style={s.dateText}>{new Date(n.createdAt).toLocaleString()}</Text>
          </TouchableOpacity>
        ))}
    </>
  );

  const renderProfile = () => (
    <>
      <Card style={{ alignItems: "center", paddingVertical: spacing.lg }}>
        <View style={s.avatar}><Text style={s.avatarText}>{(user?.firstName?.[0] || "")}{(user?.lastName?.[0] || "")}</Text></View>
        <Text style={s.profileName}>{user?.displayName}</Text>
        {!!user?.email && <Text style={s.profileEmail}>{user.email}</Text>}
      </Card>
      <TouchableOpacity style={s.settingRow} onPress={() => setShowPwModal(true)}>
        <Text style={s.settingIcon}>🔑</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.settingLabel}>Change Password</Text>
          <Text style={s.settingDesc}>Update your login password</Text>
        </View>
        <Text style={s.chevron}>›</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.settingRow, { borderColor: "#fecaca", backgroundColor: "#fff5f5" }]} onPress={handleLogout}>
        <Text style={s.settingIcon}>🚪</Text>
        <Text style={[s.settingLabel, { color: colors.danger }]}>Sign Out</Text>
      </TouchableOpacity>
    </>
  );

  // ── Payment modal ─────────────────────────────────────────────
  const renderPaymentModal = () => (
    <Modal visible={!!payPolicy} animationType="slide" onRequestClose={() => { clearInterval(pollRef.current!); setPayPolicy(null); setPayStatus("idle"); }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <SafeAreaView style={s.modal}>
        <View style={s.mHeader}>
          <Text style={s.mTitle}>Pay Premium — {payPolicy?.policyNumber}</Text>
          <TouchableOpacity onPress={() => { clearInterval(pollRef.current!); setPayPolicy(null); setPayStatus("idle"); }}><Text style={s.closeX}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView style={s.mBody} keyboardShouldPersistTaps="handled">
          {payStatus === "paid" ? (
            <View style={s.successBox}>
              <Text style={s.successEmoji}>✅</Text>
              <Text style={s.successText}>Payment Confirmed!</Text>
            </View>
          ) : payStatus === "polling" ? (
            <View style={s.successBox}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[s.successText, { color: colors.primary, marginTop: 12 }]}>Waiting for confirmation…</Text>
              <Text style={s.mHint}>Approve the payment on your phone.</Text>
            </View>
          ) : (
            <>
              <Text style={s.mLabel}>Amount ({payPolicy?.currency})</Text>
              <TextInput style={s.mInput} value={payAmount} onChangeText={setPayAmount} keyboardType="decimal-pad" />
              <Text style={s.mLabel}>Mobile Wallet</Text>
              <View style={s.chipRow}>
                {["ecocash", "onemoney", "innbucks"].map(m => (
                  <TouchableOpacity key={m} style={[s.chip, payMethod === m && s.chipActive]} onPress={() => setPayMethod(m)}>
                    <Text style={[s.chipText, payMethod === m && s.chipTextA]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.mLabel}>Mobile Number</Text>
              <TextInput style={s.mInput} value={payPhone} onChangeText={setPayPhone} keyboardType="phone-pad" placeholder="+263 77..." placeholderTextColor={colors.textMuted} />
              <Text style={s.mHint}>You will receive a USSD prompt to approve payment on your device.</Text>
              <TouchableOpacity style={[s.submitBtn, paying && s.btnDisabled]} onPress={startPayment} disabled={paying}>
                {paying ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Pay Now</Text>}
              </TouchableOpacity>
              {payStatus === "failed" && <Text style={s.errorText}>Payment failed or timed out. Please try again.</Text>}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderClaimModal = () => (
    <Modal visible={showClaimModal} animationType="slide" onRequestClose={() => setShowClaimModal(false)}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <SafeAreaView style={s.modal}>
        <View style={s.mHeader}>
          <Text style={s.mTitle}>Submit Claim</Text>
          <TouchableOpacity onPress={() => setShowClaimModal(false)}><Text style={s.closeX}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView style={s.mBody} keyboardShouldPersistTaps="handled">
          <Text style={s.mLabel}>Policy *</Text>
          {policies.map(p => (
            <TouchableOpacity key={p.id} style={[s.chip, claimPolicy === p.id && s.chipActive]} onPress={() => setClaimPolicy(p.id)}>
              <Text style={[s.chipText, claimPolicy === p.id && s.chipTextA]}>{p.policyNumber}</Text>
            </TouchableOpacity>
          ))}
          <Text style={s.mLabel}>Claim Type *</Text>
          <View style={s.chipRow}>
            {["death", "disability", "funeral", "retrenchment", "other"].map(t => (
              <TouchableOpacity key={t} style={[s.chip, claimType === t && s.chipActive]} onPress={() => setClaimType(t)}>
                <Text style={[s.chipText, claimType === t && s.chipTextA]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {(claimType === "death" || claimType === "funeral") && (
            <>
              <Text style={s.mLabel}>Deceased Name</Text>
              <TextInput style={s.mInput} value={claimDeceased} onChangeText={setClaimDeceased} autoCapitalize="words" />
              <Text style={s.mLabel}>Relationship</Text>
              <TextInput style={s.mInput} value={claimRel} onChangeText={setClaimRel} />
              <Text style={s.mLabel}>Date of Death (YYYY-MM-DD)</Text>
              <TextInput style={s.mInput} value={claimDod} onChangeText={setClaimDod} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
            </>
          )}
          <TouchableOpacity style={[s.submitBtn, submittingClaim && s.btnDisabled]} onPress={submitClaim} disabled={submittingClaim}>
            {submittingClaim ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Submit Claim</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderFeedbackModal = () => (
    <Modal visible={showFbModal} animationType="slide" onRequestClose={() => setShowFbModal(false)}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <SafeAreaView style={s.modal}>
        <View style={s.mHeader}>
          <Text style={s.mTitle}>Submit Feedback</Text>
          <TouchableOpacity onPress={() => setShowFbModal(false)}><Text style={s.closeX}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView style={s.mBody} keyboardShouldPersistTaps="handled">
          <Text style={s.mLabel}>Type</Text>
          <View style={s.chipRow}>
            {(["feedback", "complaint"] as const).map(t => (
              <TouchableOpacity key={t} style={[s.chip, fbType === t && s.chipActive]} onPress={() => setFbType(t)}>
                <Text style={[s.chipText, fbType === t && s.chipTextA]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.mLabel}>Subject *</Text>
          <TextInput style={s.mInput} value={fbSubject} onChangeText={setFbSubject} />
          <Text style={s.mLabel}>Message *</Text>
          <TextInput style={[s.mInput, { minHeight: 100 }]} value={fbMessage} onChangeText={setFbMessage} multiline />
          <TouchableOpacity style={[s.submitBtn, submittingFb && s.btnDisabled]} onPress={submitFeedback} disabled={submittingFb}>
            {submittingFb ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Submit</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderDepModal = () => (
    <Modal visible={showDepModal} animationType="slide" onRequestClose={() => setShowDepModal(false)}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <SafeAreaView style={s.modal}>
        <View style={s.mHeader}>
          <Text style={s.mTitle}>Add Dependent</Text>
          <TouchableOpacity onPress={() => setShowDepModal(false)}><Text style={s.closeX}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView style={s.mBody} keyboardShouldPersistTaps="handled">
          <Text style={s.mLabel}>First Name *</Text>
          <TextInput style={s.mInput} value={depFirst} onChangeText={setDepFirst} autoCapitalize="words" />
          <Text style={s.mLabel}>Last Name *</Text>
          <TextInput style={s.mInput} value={depLast} onChangeText={setDepLast} autoCapitalize="words" />
          <Text style={s.mLabel}>Relationship *</Text>
          <View style={s.chipRow}>
            {["Spouse","Child","Parent","Sibling","Other"].map(r => (
              <TouchableOpacity key={r} style={[s.chip, depRel === r && s.chipActive]} onPress={() => setDepRel(r)}>
                <Text style={[s.chipText, depRel === r && s.chipTextA]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.mLabel}>Date of Birth (YYYY-MM-DD)</Text>
          <TextInput style={s.mInput} value={depDob} onChangeText={setDepDob} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
          <TouchableOpacity style={[s.submitBtn, addingDep && s.btnDisabled]} onPress={addDependent} disabled={addingDep}>
            {addingDep ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Add Dependent</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderPwModal = () => (
    <Modal visible={showPwModal} animationType="slide" onRequestClose={() => setShowPwModal(false)}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <SafeAreaView style={s.modal}>
        <View style={s.mHeader}>
          <Text style={s.mTitle}>Change Password</Text>
          <TouchableOpacity onPress={() => setShowPwModal(false)}><Text style={s.closeX}>✕</Text></TouchableOpacity>
        </View>
        <ScrollView style={s.mBody} keyboardShouldPersistTaps="handled">
          <Text style={s.mLabel}>Current Password</Text>
          <TextInput style={s.mInput} value={curPw} onChangeText={setCurPw} secureTextEntry />
          <Text style={s.mLabel}>New Password (min 8 chars)</Text>
          <TextInput style={s.mInput} value={newPw} onChangeText={setNewPw} secureTextEntry />
          <TouchableOpacity style={[s.submitBtn, savingPw && s.btnDisabled]} onPress={changePassword} disabled={savingPw}>
            {savingPw ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Update Password</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  return (
    <SafeAreaView style={s.safeArea}>
      {/* Header */}
      <View style={s.header}>
        <Image source={require("../../assets/logo.png")} style={s.logo} resizeMode="contain" />
        <View style={s.headerRight}>
          {unreadCount > 0 && (
            <TouchableOpacity style={s.notifBell} onPress={() => setTab("notifications")}>
              <Text style={s.bellText}>🔔 {unreadCount}</Text>
            </TouchableOpacity>
          )}
          <Text style={s.greeting}>Hi, {user?.firstName || "Client"}</Text>
        </View>
      </View>

      {!isOnline && (
        <View style={s.offlineBanner}>
          <Text style={s.offlineText}>
            📶 Offline — cached data{cacheDate ? ` from ${new Date(cacheDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
          </Text>
        </View>
      )}

      {/* Tab bar — horizontal scroll */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll} contentContainerStyle={s.tabContent}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[s.tabItem, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Ionicons
              name={tab === t.key ? t.activeIcon : t.icon}
              size={20}
              color={tab === t.key ? colors.primary : colors.textMuted}
            />
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading && !refreshing ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={s.body}
          contentContainerStyle={s.bodyPad}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {tab === "policies"      && renderPolicies()}
          {tab === "payments"      && renderPayments()}
          {tab === "claims"        && renderClaims()}
          {tab === "documents"     && renderDocuments()}
          {tab === "feedback"      && renderFeedback()}
          {tab === "dependents"    && renderDependents()}
          {tab === "notifications" && renderNotifications()}
          {tab === "profile"       && renderProfile()}
        </ScrollView>
      )}

      {renderPaymentModal()}
      {renderClaimModal()}
      {renderFeedbackModal()}
      {renderDepModal()}
      {renderPwModal()}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: 10, backgroundColor: colors.primary },
  logo: { width: 110, height: 36 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notifBell: { backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 },
  bellText: { color: "#fff", fontSize: fontSize.xs, fontWeight: "700" },
  greeting: { color: "#fff", fontSize: fontSize.sm, fontWeight: "600" },
  offlineBanner: { backgroundColor: "#fef3c7", padding: 6, alignItems: "center" },
  offlineText: { fontSize: fontSize.xs, color: "#92400e" },
  tabScroll: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, maxHeight: 60 },
  tabContent: { paddingHorizontal: spacing.xs },
  tabItem: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, minWidth: 62 },
  tabActive: { borderBottomWidth: 3, borderBottomColor: colors.primary },
  tabIconWrap: { height: 22, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontSize: 9, color: colors.textSecondary, marginTop: 1, fontWeight: "500" },
  tabLabelActive: { color: colors.primary, fontWeight: "700" },
  body: { flex: 1 },
  bodyPad: { padding: spacing.md, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardUnread: { borderColor: colors.primary, backgroundColor: "#eff6ff" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: fontSize.xs, fontWeight: "700" },
  polNum: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, flex: 1 },
  productName: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.xs },
  dateText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  metaRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  metaCol: { flex: 1 },
  metaLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: "600" },
  metaVal: { fontSize: fontSize.sm, color: colors.text, fontWeight: "600", marginTop: 1 },
  creditLine: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs },
  payBtn: { backgroundColor: colors.primary, borderRadius: 8, padding: 10, alignItems: "center", marginTop: spacing.sm },
  payBtnText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
  dlBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  dlBtnText: { fontSize: fontSize.xs, fontWeight: "700", color: colors.primary },
  viewBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#eff6ff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#bfdbfe" },
  viewBtnText: { fontSize: fontSize.xs, fontWeight: "700", color: colors.primary },
  actionBtn: { backgroundColor: colors.primary, borderRadius: 10, padding: spacing.md, alignItems: "center", marginBottom: spacing.md },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
  markAllBtn: { backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: 8, alignItems: "center", marginBottom: spacing.sm },
  markAllText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: "600" },
  notifTitle: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, flex: 1 },
  notifMsg: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  removeBtn: { backgroundColor: "#fee2e2", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#fecaca" },
  removeBtnText: { color: colors.danger, fontWeight: "600", fontSize: fontSize.xs },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  avatarText: { fontSize: 28, fontWeight: "700", color: "#fff" },
  profileName: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, textAlign: "center" },
  profileEmail: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: "center", marginTop: 4 },
  settingRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  settingIcon: { fontSize: 20, marginRight: 12, width: 32 },
  settingLabel: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  settingDesc: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  chevron: { fontSize: 20, color: colors.textMuted },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  emptySub: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: "center", marginTop: spacing.xs },
  modal: { flex: 1, backgroundColor: colors.background },
  mHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  mTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, flex: 1 },
  closeX: { fontSize: 20, color: colors.textSecondary, padding: spacing.sm },
  mBody: { padding: spacing.md },
  mLabel: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  mInput: { backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: spacing.md, fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border },
  mHint: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 20, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, marginRight: spacing.xs, marginBottom: spacing.xs },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, color: colors.text },
  chipTextA: { color: "#fff", fontWeight: "600" },
  submitBtn: { backgroundColor: colors.primary, borderRadius: 12, padding: spacing.md, alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.xl },
  btnDisabled: { opacity: 0.6 },
  submitText: { color: "#fff", fontSize: fontSize.md, fontWeight: "700" },
  successBox: { alignItems: "center", paddingVertical: 60 },
  successEmoji: { fontSize: 64 },
  successText: { fontSize: fontSize.xl, fontWeight: "700", color: colors.success, marginTop: spacing.md },
  errorText: { color: colors.danger, textAlign: "center", marginTop: spacing.md, fontSize: fontSize.sm },
});
