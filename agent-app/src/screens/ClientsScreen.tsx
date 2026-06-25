import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, ScrollView, Alert, RefreshControl, ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema";
import { useNetwork } from "../context/NetworkContext";
import { fullSync, refreshCache } from "../sync/engine";
import { API_BASE } from "../config";
import { apiPost } from "../api";
import { colors, spacing, fontSize } from "../theme";
import DateField from "../components/DateField";

interface Client {
  local_id: string;
  server_id: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  national_id: string | null;
  date_of_birth: string | null;
  gender: string | null;
  title: string | null;
  marital_status: string | null;
  address: string | null;
  preferred_comm_method: string | null;
  location: string | null;
  selling_point: string | null;
  objections_faced: string | null;
  response_to_objections: string | null;
  client_feedback: string | null;
  synced: number;
}

interface ServerDocument {
  id: string;
  clientId: string;
  documentType: string;
  label: string | null;
  fileName: string;
  mimeType: string | null;
  fileUrl: string;
  fileSize: number | null;
  createdAt: string;
}

interface Dependent {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string | null;
  nationalId: string | null;
  dateOfBirth: string | null;
}

interface PolicySummary {
  id: string;
  policyNumber: string | null;
  status: string;
  premiumAmount: string | null;
  currency: string;
  paymentSchedule: string;
  productName?: string;
}

const NATIONAL_ID_REGEX = /^\d+[A-Z]\d{2}$/;

const DOC_TYPES = [
  { value: "national_id", label: "National ID" },
  { value: "passport", label: "Passport" },
  { value: "proof_of_address", label: "Proof of Address" },
  { value: "birth_certificate", label: "Birth Certificate" },
  { value: "other", label: "Other" },
];

const EMPTY_FORM = {
  title: "", firstName: "", lastName: "", phone: "", email: "",
  nationalId: "", dateOfBirth: "", gender: "", maritalStatus: "", address: "",
  preferredCommMethod: "", location: "", sellingPoint: "",
  objectionsFaced: "", responseToObjections: "", clientFeedback: "",
};

export default function ClientsScreen({ navigation }: any) {
  const { isOnline } = useNetwork();
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offlineSavedBanner, setOfflineSavedBanner] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientDocs, setClientDocs] = useState<ServerDocument[]>([]);
  const [clientDeps, setClientDeps] = useState<Dependent[]>([]);
  const [clientPolicies, setClientPolicies] = useState<PolicySummary[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [showDocUpload, setShowDocUpload] = useState(false);
  const [docType, setDocType] = useState("other");
  const [docLabel, setDocLabel] = useState("");
  const [pendingFile, setPendingFile] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadClients = useCallback(async () => {
    const db = await getDb();
    const local = await db.getAllAsync<Client>(
      "SELECT * FROM clients ORDER BY created_at DESC"
    );
    const cached = await db.getAllAsync<{ id: string; data: string }>(
      "SELECT * FROM cache_my_clients"
    );
    const localServerIds = new Set(local.filter(c => c.server_id).map(c => c.server_id));
    const cachedClients: Client[] = cached
      .map(c => {
        const d = JSON.parse(c.data);
        return {
          local_id: c.id, server_id: c.id,
          first_name: d.firstName || "", last_name: d.lastName || "",
          phone: d.phone || null, email: d.email || null,
          national_id: d.nationalId || null, date_of_birth: d.dateOfBirth || null,
          gender: d.gender || null, title: d.title || null,
          marital_status: d.maritalStatus || null, address: d.address || null,
          preferred_comm_method: d.preferredCommMethod || null,
          location: d.location || null, selling_point: d.sellingPoint || null,
          objections_faced: d.objectionsFaced || null,
          response_to_objections: d.responseToObjections || null,
          client_feedback: d.clientFeedback || null,
          synced: 1,
        };
      })
      .filter(c => !localServerIds.has(c.server_id));
    setClients([...local, ...cachedClients]);
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (isOnline) {
      try { await fullSync(); } catch {}
    }
    await loadClients();
    setRefreshing(false);
  }, [isOnline, loadClients]);

  const loadClientDetail = useCallback(async (client: Client) => {
    setClientDocs([]);
    setClientDeps([]);
    setClientPolicies([]);
    if (!client.server_id || !isOnline) return;
    setIsLoadingDetail(true);
    try {
      const [docsRes, depsRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/clients/${client.server_id}/documents`, { credentials: "include" }),
        fetch(`${API_BASE}/api/clients/${client.server_id}/dependents`, { credentials: "include" }),
      ]);
      if (docsRes.status === "fulfilled" && docsRes.value.ok) {
        setClientDocs(await docsRes.value.json());
      }
      if (depsRes.status === "fulfilled" && depsRes.value.ok) {
        setClientDeps(await depsRes.value.json());
      }
      // Load policies from local cache filtered by this client
      const db = await getDb();
      const localPols = await db.getAllAsync<any>(
        "SELECT * FROM policies WHERE client_server_id = ? OR client_local_id = ? ORDER BY created_at DESC",
        client.server_id, client.local_id
      );
      const cachedPols = await db.getAllAsync<{ id: string; data: string }>("SELECT * FROM cache_my_policies");
      const serverPols: PolicySummary[] = cachedPols
        .map(p => JSON.parse(p.data))
        .filter((p: any) => p.clientId === client.server_id)
        .map((p: any) => ({
          id: p.id, policyNumber: p.policyNumber, status: p.status,
          premiumAmount: p.premiumAmount, currency: p.currency,
          paymentSchedule: p.paymentSchedule, productName: p.productVersionId,
        }));
      const localPolsSummary: PolicySummary[] = localPols.map((p: any) => ({
        id: p.local_id, policyNumber: p.policy_number || null, status: p.status || "pending_sync",
        premiumAmount: p.premium_amount, currency: p.currency || "USD",
        paymentSchedule: p.payment_schedule, productName: p.product_name,
      }));
      const allPolIds = new Set(serverPols.map(p => p.id));
      setClientPolicies([...serverPols, ...localPolsSummary.filter(p => !allPolIds.has(p.id))]);
    } catch {}
    finally { setIsLoadingDetail(false); }
  }, [isOnline]);

  const openClientDetail = useCallback((client: Client) => {
    setSelectedClient(client);
    loadClientDetail(client);
  }, [loadClientDetail]);

  const handleCreate = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      Alert.alert("Validation Error", "First name and last name are required.");
      return;
    }
    if (!form.nationalId.trim()) {
      Alert.alert("Validation Error", "National ID is required.");
      return;
    }
    if (!NATIONAL_ID_REGEX.test(form.nationalId.trim().toUpperCase())) {
      Alert.alert("Validation Error", "National ID must be digits followed by one letter then two digits (e.g. 08833089H38).");
      return;
    }
    if (!form.phone.trim()) {
      Alert.alert("Validation Error", "Phone number is required.");
      return;
    }
    if (!form.dateOfBirth.trim()) {
      Alert.alert("Validation Error", "Date of birth is required.");
      return;
    }
    if (!form.gender) {
      Alert.alert("Validation Error", "Gender is required.");
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title || undefined,
      firstName: form.firstName.trim().toUpperCase(),
      lastName: form.lastName.trim().toUpperCase(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      nationalId: form.nationalId.trim().toUpperCase() || undefined,
      dateOfBirth: form.dateOfBirth.trim() || undefined,
      gender: form.gender || undefined,
      maritalStatus: form.maritalStatus || undefined,
      address: form.address.trim() || undefined,
      preferredCommMethod: form.preferredCommMethod || undefined,
      location: form.location.trim() || undefined,
      sellingPoint: form.sellingPoint.trim() || undefined,
      objectionsFaced: form.objectionsFaced.trim() || undefined,
      responseToObjections: form.responseToObjections.trim() || undefined,
      clientFeedback: form.clientFeedback.trim() || undefined,
    };
    try {
      if (isOnline) {
        // Direct API POST — surface server validation errors immediately
        const serverClient = await apiPost("/api/clients", payload);
        const db = await getDb();
        const localId = uuidv4();
        await db.runAsync(
          `INSERT INTO clients (local_id, server_id, title, first_name, last_name, phone, email,
            national_id, date_of_birth, gender, marital_status, address,
            preferred_comm_method, location, selling_point, objections_faced,
            response_to_objections, client_feedback, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          localId, serverClient.id,
          payload.title || null, payload.firstName, payload.lastName,
          payload.phone || null, payload.email || null,
          payload.nationalId || null, payload.dateOfBirth || null,
          payload.gender || null, payload.maritalStatus || null,
          payload.address || null, payload.preferredCommMethod || null,
          payload.location || null, payload.sellingPoint || null,
          payload.objectionsFaced || null, payload.responseToObjections || null,
          payload.clientFeedback || null,
        );
      } else {
        // Offline: save locally, sync later
        const db = await getDb();
        const localId = uuidv4();
        await db.runAsync(
          `INSERT INTO clients (local_id, title, first_name, last_name, phone, email,
            national_id, date_of_birth, gender, marital_status, address,
            preferred_comm_method, location, selling_point, objections_faced,
            response_to_objections, client_feedback, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          localId,
          payload.title || null, payload.firstName, payload.lastName,
          payload.phone || null, payload.email || null,
          payload.nationalId || null, payload.dateOfBirth || null,
          payload.gender || null, payload.maritalStatus || null,
          payload.address || null, payload.preferredCommMethod || null,
          payload.location || null, payload.sellingPoint || null,
          payload.objectionsFaced || null, payload.responseToObjections || null,
          payload.clientFeedback || null,
        );
      }
      setForm({ ...EMPTY_FORM });
      setShowCreate(false);
      await loadClients();
      if (isOnline) {
        try { await refreshCache("clients"); await loadClients(); } catch {}
      } else {
        // Surface a clear, persistent confirmation that the record is queued
        setOfflineSavedBanner(true);
        setTimeout(() => setOfflineSavedBanner(false), 6000);
      }
    } catch (e: any) {
      // Duplicate national ID: server responds 409 with existingClient
      if (e.message?.includes("409") || e.message?.toLowerCase().includes("duplicate") || e.message?.toLowerCase().includes("already exists")) {
        Alert.alert("Duplicate Client", "A client with this National ID already exists on the server.");
      } else {
        Alert.alert("Save Failed", e.message || "Could not save client.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePickDocument = async () => {
    Alert.alert("Select Source", "Choose where to pick the document from", [
      {
        text: "Camera",
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission required", "Camera access is needed.");
            return;
          }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 0.8 });
          if (!result.canceled && result.assets[0]) {
            const a = result.assets[0];
            setPendingFile({ uri: a.uri, name: a.fileName || `doc_${Date.now()}.jpg`, mimeType: a.mimeType || "image/jpeg" });
          }
        },
      },
      {
        text: "Gallery",
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("Permission required", "Photo library access is needed.");
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.8 });
          if (!result.canceled && result.assets[0]) {
            const a = result.assets[0];
            setPendingFile({ uri: a.uri, name: a.fileName || `doc_${Date.now()}.jpg`, mimeType: a.mimeType || "image/jpeg" });
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleUploadDocument = async () => {
    if (!pendingFile || !selectedClient?.server_id) return;
    setUploading(true);
    try {
      if (isOnline) {
        const formData = new FormData();
        formData.append("file", { uri: pendingFile.uri, type: pendingFile.mimeType, name: pendingFile.name } as any);
        formData.append("documentType", docType);
        formData.append("label", docLabel || pendingFile.name);
        const res = await fetch(`${API_BASE}/api/clients/${selectedClient.server_id}/documents`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Upload failed");
        }
        Alert.alert("Success", "Document uploaded.");
        const docsRes2 = await fetch(`${API_BASE}/api/clients/${selectedClient.server_id}/documents`, { credentials: "include" });
        if (docsRes2.ok) setClientDocs(await docsRes2.json());
      } else {
        const db = await getDb();
        await db.runAsync(
          `INSERT INTO document_upload_queue (client_server_id, document_type, label, file_uri, file_name, mime_type)
           VALUES (?, ?, ?, ?, ?, ?)`,
          selectedClient.server_id, docType, docLabel || pendingFile.name,
          pendingFile.uri, pendingFile.name, pendingFile.mimeType,
        );
        Alert.alert("Queued", "Document saved offline. It will upload automatically when you reconnect.");
      }
      setShowDocUpload(false);
      setPendingFile(null);
      setDocLabel("");
      setDocType("other");
    } catch (e: any) {
      Alert.alert("Upload failed", e.message);
    } finally {
      setUploading(false);
    }
  };

  const filtered = search
    ? clients.filter(c =>
        `${c.first_name} ${c.last_name} ${c.national_id || ""}`.toLowerCase().includes(search.toLowerCase())
      )
    : clients;

  return (
    <View style={styles.container}>
      {offlineSavedBanner && (
        <View style={styles.savedBanner}>
          <Text style={styles.savedBannerText}>✓ Saved offline — will sync when you reconnect</Text>
        </View>
      )}
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder="Search clients…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity style={styles.addButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.addButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.local_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No clients yet</Text>
            <Text style={styles.emptySubtext}>Tap + New to capture a client</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.clientCard} onPress={() => openClientDetail(item)} activeOpacity={0.7}>
            <View style={styles.clientInfo}>
              <Text style={styles.clientName}>{item.first_name} {item.last_name}</Text>
              {item.national_id && <Text style={styles.clientDetail}>ID: {item.national_id}</Text>}
              {item.phone && <Text style={styles.clientDetail}>📱 {item.phone}</Text>}
            </View>
            <View style={[styles.syncBadge, item.synced ? styles.syncedBadge : styles.pendingBadge]}>
              <Text style={[styles.syncBadgeText, item.synced ? styles.syncedText : styles.pendingText]}>
                {item.synced ? "✓ Synced" : "⏳ Pending"}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* ── Create Client Modal ── */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setShowCreate(false); setForm({ ...EMPTY_FORM }); }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Client</Text>
            <TouchableOpacity onPress={handleCreate} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color={colors.accent} />
                : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Title</Text>
            <View style={styles.genderRow}>
              {["Mr","Mrs","Ms","Miss","Dr","Prof"].map(t => (
                <TouchableOpacity key={t} style={[styles.genderButton, form.title === t && styles.genderSelected]}
                  onPress={() => setForm(f => ({ ...f, title: t }))}>
                  <Text style={[styles.genderText, form.title === t && styles.genderSelectedText]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>First Name *</Text>
            <TextInput style={styles.input} value={form.firstName} onChangeText={(v) => setForm(f => ({ ...f, firstName: v }))} autoCapitalize="characters" />

            <Text style={styles.label}>Last Name *</Text>
            <TextInput style={styles.input} value={form.lastName} onChangeText={(v) => setForm(f => ({ ...f, lastName: v }))} autoCapitalize="characters" />

            <Text style={styles.label}>National ID *</Text>
            <TextInput style={styles.input} value={form.nationalId} onChangeText={(v) => setForm(f => ({ ...f, nationalId: v }))} autoCapitalize="characters" placeholder="e.g. 08833089H38" placeholderTextColor={colors.textMuted} />

            <Text style={styles.label}>Phone</Text>
            <TextInput style={styles.input} value={form.phone} onChangeText={(v) => setForm(f => ({ ...f, phone: v }))} keyboardType="phone-pad" placeholder="+263..." placeholderTextColor={colors.textMuted} />

            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={form.email} onChangeText={(v) => setForm(f => ({ ...f, email: v }))} keyboardType="email-address" autoCapitalize="none" />

            <Text style={styles.label}>Date of Birth</Text>
            <DateField value={form.dateOfBirth} onChange={(v) => setForm(f => ({ ...f, dateOfBirth: v }))} placeholder="Select date of birth" maxYear={new Date().getFullYear()} />

            <Text style={styles.label}>Gender</Text>
            <View style={styles.genderRow}>
              {["MALE", "FEMALE", "OTHER"].map(g => (
                <TouchableOpacity key={g}
                  style={[styles.genderButton, form.gender === g && styles.genderSelected]}
                  onPress={() => setForm(f => ({ ...f, gender: g }))}
                >
                  <Text style={[styles.genderText, form.gender === g && styles.genderSelectedText]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Marital Status</Text>
            <View style={styles.genderRow}>
              {["Single","Married","Divorced","Widowed","Separated"].map(s => (
                <TouchableOpacity key={s} style={[styles.genderButton, form.maritalStatus === s && styles.genderSelected]}
                  onPress={() => setForm(f => ({ ...f, maritalStatus: s }))}>
                  <Text style={[styles.genderText, form.maritalStatus === s && styles.genderSelectedText]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Address</Text>
            <TextInput style={[styles.input, { minHeight: 60 }]} value={form.address}
              onChangeText={(v) => setForm(f => ({ ...f, address: v }))}
              placeholder="Street, suburb, city..." placeholderTextColor={colors.textMuted}
              multiline />

            <Text style={styles.label}>Location / Area</Text>
            <TextInput style={styles.input} value={form.location}
              onChangeText={(v) => setForm(f => ({ ...f, location: v }))}
              placeholder="e.g. Harare CBD, Bulawayo" placeholderTextColor={colors.textMuted} />

            <Text style={styles.label}>Preferred Contact Method</Text>
            <View style={styles.genderRow}>
              {["sms","whatsapp","calls","email"].map(m => (
                <TouchableOpacity key={m}
                  style={[styles.genderButton, form.preferredCommMethod === m && styles.genderSelected]}
                  onPress={() => setForm(f => ({ ...f, preferredCommMethod: m }))}>
                  <Text style={[styles.genderText, form.preferredCommMethod === m && styles.genderSelectedText]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Selling Point / Notes</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={form.sellingPoint}
              onChangeText={(v) => setForm(f => ({ ...f, sellingPoint: v }))}
              placeholder="What convinced the client?" placeholderTextColor={colors.textMuted}
              multiline />

            <Text style={styles.label}>Objections Faced</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={form.objectionsFaced}
              onChangeText={(v) => setForm(f => ({ ...f, objectionsFaced: v }))}
              placeholder="Any objections raised..." placeholderTextColor={colors.textMuted}
              multiline />

            <Text style={styles.label}>Response to Objections</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={form.responseToObjections}
              onChangeText={(v) => setForm(f => ({ ...f, responseToObjections: v }))}
              placeholder="How objections were resolved..." placeholderTextColor={colors.textMuted}
              multiline />

            <Text style={styles.label}>Client Feedback</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={form.clientFeedback}
              onChangeText={(v) => setForm(f => ({ ...f, clientFeedback: v }))}
              placeholder="General client feedback..." placeholderTextColor={colors.textMuted}
              multiline />
          </ScrollView>
        </View>
      </Modal>

      {/* ── Client Detail Modal ── */}
      {selectedClient && (
        <Modal
          visible={!!selectedClient}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setSelectedClient(null)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSelectedClient(null)}>
                <Text style={styles.cancelText}>← Back</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {selectedClient.first_name} {selectedClient.last_name}
              </Text>
              {selectedClient.server_id ? (
                <TouchableOpacity
                  style={styles.issuePolicyBtn}
                  onPress={() => {
                    setSelectedClient(null);
                    navigation.navigate("Policies", {
                      screen: "CreatePolicy",
                      params: { preselectedClientId: selectedClient.server_id, preselectedClientName: `${selectedClient.first_name} ${selectedClient.last_name}` },
                    });
                  }}
                >
                  <Text style={styles.issuePolicyBtnText}>📋 Issue</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ width: 60 }} />
              )}
            </View>
            <ScrollView style={styles.modalBody}>
              {/* Client Info */}
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Client Info</Text>
                {!!selectedClient.national_id && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>National ID</Text>
                    <Text style={styles.infoValue}>{selectedClient.national_id}</Text>
                  </View>
                )}
                {!!selectedClient.phone && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Phone</Text>
                    <Text style={styles.infoValue}>{selectedClient.phone}</Text>
                  </View>
                )}
                {!!selectedClient.email && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Email</Text>
                    <Text style={styles.infoValue}>{selectedClient.email}</Text>
                  </View>
                )}
                {!!selectedClient.date_of_birth && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Date of Birth</Text>
                    <Text style={styles.infoValue}>{selectedClient.date_of_birth}</Text>
                  </View>
                )}
                <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.infoLabel}>Sync status</Text>
                  <View style={[styles.syncBadge, selectedClient.synced ? styles.syncedBadge : styles.pendingBadge]}>
                    <Text style={[styles.syncBadgeText, selectedClient.synced ? styles.syncedText : styles.pendingText]}>
                      {selectedClient.synced ? "✓ Synced" : "⏳ Pending sync"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Linked Policies */}
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Linked Policies</Text>
                {isLoadingDetail ? (
                  <ActivityIndicator style={{ marginVertical: spacing.sm }} color={colors.primary} />
                ) : clientPolicies.length === 0 ? (
                  <Text style={styles.emptyDocsText}>No policies yet</Text>
                ) : (
                  clientPolicies.map(pol => (
                    <View key={pol.id} style={styles.polRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.polNumber}>{pol.policyNumber || "Pending sync…"}</Text>
                        <Text style={styles.polDetail}>{pol.currency} {pol.premiumAmount || "0"} / {pol.paymentSchedule}</Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: pol.status === "active" ? "#dcfce7" : pol.status === "pending_sync" ? "#fef3c7" : "#fee2e2" }]}>
                        <Text style={[styles.statusPillText, { color: pol.status === "active" ? "#166534" : pol.status === "pending_sync" ? "#92400e" : "#991b1b" }]}>
                          {pol.status === "pending_sync" ? "PENDING" : pol.status.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* Dependents Section */}
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Dependents / Family</Text>
                {isLoadingDetail ? (
                  <ActivityIndicator style={{ marginVertical: spacing.sm }} color={colors.primary} />
                ) : !selectedClient.server_id || !isOnline ? (
                  <View style={styles.hint}>
                    <Text style={styles.hintText}>📶 Connect to load dependents.</Text>
                  </View>
                ) : clientDeps.length === 0 ? (
                  <Text style={styles.emptyDocsText}>No dependents on record</Text>
                ) : (
                  clientDeps.map(dep => (
                    <View key={dep.id} style={styles.docRow}>
                      <View style={styles.docInfo}>
                        <Text style={styles.docName}>{dep.firstName} {dep.lastName}</Text>
                        <Text style={styles.docMeta}>
                          {dep.relationship || "Dependent"}{dep.nationalId ? ` · ${dep.nationalId}` : ""}
                          {dep.dateOfBirth ? ` · ${dep.dateOfBirth}` : ""}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* Documents Section */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Documents</Text>
                  {!!selectedClient.server_id && (
                    <TouchableOpacity
                      style={styles.uploadButton}
                      onPress={() => { setPendingFile(null); setDocLabel(""); setDocType("other"); setShowDocUpload(true); }}
                    >
                      <Text style={styles.uploadButtonText}>+ Upload</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {!selectedClient.server_id ? (
                  <View style={styles.hint}>
                    <Text style={styles.hintText}>📤 Sync this client to the server first before uploading documents.</Text>
                  </View>
                ) : !isOnline ? (
                  <View style={styles.hint}>
                    <Text style={styles.hintText}>📶 Offline — documents will load when you reconnect.</Text>
                  </View>
                ) : isLoadingDetail ? (
                  <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.primary} />
                ) : clientDocs.length === 0 ? (
                  <View style={styles.emptyDocs}>
                    <Text style={styles.emptyDocsText}>No documents uploaded yet</Text>
                    <Text style={styles.emptyDocsSubtext}>Tap + Upload to add ID copies or proof of address</Text>
                  </View>
                ) : (
                  clientDocs.map((doc) => (
                    <View key={doc.id} style={styles.docRow}>
                      <View style={styles.docInfo}>
                        <Text style={styles.docName} numberOfLines={1}>{doc.label || doc.fileName}</Text>
                        <Text style={styles.docMeta}>
                          {doc.documentType.replace(/_/g, " ")}
                          {doc.fileSize ? ` · ${(doc.fileSize / 1024).toFixed(1)} KB` : ""}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={styles.docDate}>{new Date(doc.createdAt).toLocaleDateString()}</Text>
                        {!!doc.fileUrl && (
                          <TouchableOpacity
                            onPress={() => WebBrowser.openBrowserAsync(doc.fileUrl)}
                            style={styles.viewDocBtn}
                          >
                            <Text style={styles.viewDocText}>View</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </View>
        </Modal>
      )}

      {/* ── Document Upload Modal ── */}
      <Modal
        visible={showDocUpload}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowDocUpload(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowDocUpload(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Upload Document</Text>
            <TouchableOpacity onPress={handleUploadDocument} disabled={!pendingFile || uploading}>
              <Text style={[styles.saveText, (!pendingFile || uploading) && { opacity: 0.4 }]}>
                {uploading ? "Uploading…" : "Upload"}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={styles.label}>Document Type</Text>
            <View style={styles.typeRow}>
              {DOC_TYPES.map(t => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.typeChip, docType === t.value && styles.typeChipSelected]}
                  onPress={() => setDocType(t.value)}
                >
                  <Text style={[styles.typeChipText, docType === t.value && styles.typeChipTextSelected]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Label (optional)</Text>
            <TextInput
              style={styles.input}
              value={docLabel}
              onChangeText={setDocLabel}
              placeholder="e.g. Front of ID"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>File</Text>
            <TouchableOpacity style={styles.pickZone} onPress={handlePickDocument}>
              {pendingFile ? (
                <View style={{ alignItems: "center" }}>
                  <Text style={styles.pickZoneText}>✓ {pendingFile.name}</Text>
                  <Text style={styles.pickZoneSub}>Tap to change</Text>
                </View>
              ) : (
                <Text style={styles.pickZoneText}>📷 Tap to pick from camera or gallery</Text>
              )}
            </TouchableOpacity>

            {!isOnline && !!pendingFile && (
              <View style={[styles.hint, { marginTop: spacing.md }]}>
                <Text style={styles.hintText}>📶 Offline — document will be queued and uploaded when you reconnect.</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  savedBanner: { backgroundColor: "#dcfce7", paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center" },
  savedBannerText: { fontSize: fontSize.sm, color: "#166534", fontWeight: "600" },
  header: { flexDirection: "row", padding: spacing.md, gap: spacing.sm },
  search: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  addButton: {
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: spacing.md, justifyContent: "center",
  },
  addButtonText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
  emptyContainer: { flex: 1, justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl },
  emptyText: { fontSize: fontSize.lg, fontWeight: "600", color: colors.textSecondary },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  clientCard: {
    backgroundColor: colors.surface, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    borderRadius: 10, padding: spacing.md, flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  clientInfo: { flex: 1 },
  clientName: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  clientDetail: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  syncBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 6 },
  syncedBadge: { backgroundColor: "#dcfce7" },
  pendingBadge: { backgroundColor: "#fef3c7" },
  syncBadgeText: { fontSize: fontSize.xs, fontWeight: "600" },
  syncedText: { color: "#166534" },
  pendingText: { color: "#92400e" },
  // Modal base
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, flex: 1, textAlign: "center" },
  cancelText: { fontSize: fontSize.md, color: colors.danger },
  saveText: { fontSize: fontSize.md, color: colors.accent, fontWeight: "700" },
  issuePolicyBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  issuePolicyBtnText: { color: "#fff", fontSize: fontSize.xs, fontWeight: "700" },
  modalBody: { padding: spacing.md },
  label: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md,
    fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  genderRow: { flexDirection: "row", gap: spacing.sm },
  genderButton: {
    flex: 1, padding: spacing.sm, borderRadius: 8, borderWidth: 1,
    borderColor: colors.border, alignItems: "center", backgroundColor: colors.surface,
  },
  genderSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  genderText: { fontWeight: "600", color: colors.text },
  genderSelectedText: { color: "#fff" },
  // Detail view
  sectionCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  sectionTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  infoRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  infoLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  infoValue: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, flexShrink: 1, textAlign: "right", marginLeft: spacing.sm },
  uploadButton: {
    backgroundColor: colors.primary, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
  },
  uploadButtonText: { color: "#fff", fontWeight: "700", fontSize: fontSize.sm },
  hint: { backgroundColor: "#fef9c3", borderRadius: 8, padding: spacing.sm },
  hintText: { fontSize: fontSize.sm, color: "#92400e" },
  emptyDocs: { alignItems: "center", paddingVertical: spacing.lg },
  emptyDocsText: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textSecondary },
  emptyDocsSubtext: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  docRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  docInfo: { flex: 1, marginRight: spacing.sm },
  docName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  docMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2, textTransform: "capitalize" },
  docDate: { fontSize: fontSize.xs, color: colors.textMuted },
  viewDocBtn: { backgroundColor: colors.primary + "18", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  viewDocText: { fontSize: fontSize.xs, color: colors.primary, fontWeight: "600" },
  // Policy rows in detail
  polRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  polNumber: { fontSize: fontSize.sm, fontWeight: "700", color: colors.primary },
  polDetail: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6 },
  statusPillText: { fontSize: fontSize.xs, fontWeight: "700" },
  // Document type chips
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.xs },
  typeChip: {
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  typeChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: fontSize.xs, color: colors.text, fontWeight: "600" },
  typeChipTextSelected: { color: "#fff" },
  // Pick zone
  pickZone: {
    backgroundColor: colors.surface, borderRadius: 10, padding: spacing.lg,
    borderWidth: 2, borderStyle: "dashed", borderColor: colors.border,
    alignItems: "center",
  },
  pickZoneText: { fontSize: fontSize.md, color: colors.text, fontWeight: "600" },
  pickZoneSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
});
