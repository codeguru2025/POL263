import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Text, View, StyleSheet, Image, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DashboardScreen from "../screens/DashboardScreen";
import ClientsScreen from "../screens/ClientsScreen";
import PoliciesScreen from "../screens/PoliciesScreen";
import CreatePolicyScreen from "../screens/CreatePolicyScreen";
import LeadsScreen from "../screens/LeadsScreen";
import CommissionsScreen from "../screens/CommissionsScreen";
import PaymentsScreen from "../screens/PaymentsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import ClaimsScreen from "../screens/ClaimsScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import ReportsScreen from "../screens/ReportsScreen";
import GroupsScreen from "../screens/GroupsScreen";
import ApprovalsScreen from "../screens/ApprovalsScreen";
import FuneralsScreen from "../screens/FuneralsScreen";
import { colors, fontSize } from "../theme";
import { useNetwork } from "../context/NetworkContext";
import AutoSync from "../sync/AutoSync";

const Tab = createBottomTabNavigator();
const PolicyStack = createNativeStackNavigator();
const MoreStack = createNativeStackNavigator();

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function LogoHeader() {
  return (
    <Image
      source={require("../../assets/logo.png")}
      style={{ width: 120, height: 32 }}
      resizeMode="contain"
    />
  );
}

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, { active: IoniconName; inactive: IoniconName }> = {
    Home:     { active: "home",          inactive: "home-outline" },
    Clients:  { active: "people",        inactive: "people-outline" },
    Policies: { active: "document-text", inactive: "document-text-outline" },
    Leads:    { active: "trending-up",   inactive: "trending-up-outline" },
    More:     { active: "grid",          inactive: "grid-outline" },
  };
  const ic = icons[label] || { active: "ellipsis-horizontal", inactive: "ellipsis-horizontal-outline" };
  return (
    <Ionicons
      name={focused ? ic.active : ic.inactive}
      size={22}
      color={focused ? colors.primary : colors.textMuted}
    />
  );
}

function PoliciesStackScreen() {
  return (
    <PolicyStack.Navigator>
      <PolicyStack.Screen
        name="PoliciesList"
        component={PoliciesScreen}
        options={{ headerShown: false }}
      />
      <PolicyStack.Screen
        name="CreatePolicy"
        component={CreatePolicyScreen}
        options={{
          title: "Issue Policy",
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontWeight: "700" },
        }}
      />
    </PolicyStack.Navigator>
  );
}

type MoreItem = { label: string; icon: IoniconName; screen: string; color: string };

const MORE_SECTIONS: { title: string; items: MoreItem[] }[] = [
  {
    title: "My Work",
    items: [
      { label: "Claims",    icon: "medkit-outline",           screen: "Claims",    color: "#e11d48" },
      { label: "Funerals",  icon: "flower-outline",           screen: "Funerals",  color: "#6d28d9" },
      { label: "Approvals", icon: "checkmark-circle-outline", screen: "Approvals", color: "#d97706" },
      { label: "Groups",    icon: "people-circle-outline",    screen: "Groups",    color: "#0891b2" },
    ],
  },
  {
    title: "Money & Insights",
    items: [
      { label: "Commissions",   icon: "cash-outline",          screen: "Commissions",   color: "#16a34a" },
      { label: "Payments",      icon: "card-outline",          screen: "Payments",      color: "#2563eb" },
      { label: "Reports",       icon: "bar-chart-outline",     screen: "Reports",       color: "#7c3aed" },
      { label: "Notifications", icon: "notifications-outline", screen: "Notifications", color: "#9333ea" },
    ],
  },
];

function MoreMenuScreen({ navigation }: any) {
  return (
    <SafeAreaView style={moreStyles.safeArea} edges={["top"]}>
      <Image source={require("../../assets/logo.png")} style={moreStyles.logo} resizeMode="contain" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {MORE_SECTIONS.map(section => (
          <View key={section.title} style={moreStyles.section}>
            <Text style={moreStyles.sectionTitle}>{section.title}</Text>
            <View style={moreStyles.grid}>
              {section.items.map(item => (
                <TouchableOpacity
                  key={item.screen}
                  style={moreStyles.gridCard}
                  onPress={() => navigation.navigate(item.screen)}
                  activeOpacity={0.7}
                >
                  <View style={[moreStyles.iconWrap, { backgroundColor: item.color + "18" }]}>
                    <Ionicons name={item.icon} size={24} color={item.color} />
                  </View>
                  <Text style={moreStyles.gridLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Settings — single full-width row */}
        <TouchableOpacity
          style={moreStyles.settingsRow}
          onPress={() => navigation.navigate("SettingsDetail")}
          activeOpacity={0.7}
        >
          <View style={[moreStyles.iconWrap, { backgroundColor: "#47556918" }]}>
            <Ionicons name="settings-outline" size={22} color="#475569" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={moreStyles.settingsLabel}>Settings</Text>
            <Text style={moreStyles.settingsDesc}>Sync, profile, and logout</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const moreStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  logo: { width: 140, height: 40, alignSelf: "center", marginBottom: 12, marginTop: 8 },
  section: { marginBottom: 8 },
  sectionTitle: {
    fontSize: 12, fontWeight: "700", color: colors.textMuted,
    letterSpacing: 0.8, textTransform: "uppercase",
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12 },
  gridCard: {
    width: "46%", margin: "2%", backgroundColor: colors.surface, borderRadius: 14,
    paddingVertical: 18, alignItems: "center", borderWidth: 1, borderColor: colors.border,
  },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  gridLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  settingsRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surface,
    marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  settingsLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  settingsDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});

const navOpts = { headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.primary, headerTitleStyle: { fontWeight: "700" as const } };

function MoreStackScreen() {
  return (
    <MoreStack.Navigator>
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ headerShown: false }} />
      <MoreStack.Screen name="Claims" component={ClaimsScreen} options={{ title: "Claims", ...navOpts }} />
      <MoreStack.Screen name="Funerals" component={FuneralsScreen} options={{ title: "Funeral Operations", ...navOpts }} />
      <MoreStack.Screen name="Commissions" component={CommissionsScreen} options={{ ...navOpts }} />
      <MoreStack.Screen name="Payments" component={PaymentsScreen} options={{ ...navOpts }} />
      <MoreStack.Screen name="Reports" component={ReportsScreen} options={{ title: "Reports & Analytics", ...navOpts }} />
      <MoreStack.Screen name="Groups" component={GroupsScreen} options={{ title: "Group Policies", ...navOpts }} />
      <MoreStack.Screen name="Approvals" component={ApprovalsScreen} options={{ title: "Approvals", ...navOpts }} />
      <MoreStack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifications", ...navOpts }} />
      <MoreStack.Screen name="SettingsDetail" component={SettingsScreen} options={{ title: "Settings", ...navOpts }} />
    </MoreStack.Navigator>
  );
}

function OfflineBanner() {
  const { isOnline } = useNetwork();
  if (isOnline) return null;
  return (
    <View style={bannerStyles.container}>
      <Text style={bannerStyles.text}>📡 Offline — changes saved locally</Text>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    backgroundColor: "#fef3c7",
    paddingVertical: 4,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  text: { fontSize: fontSize.xs, color: "#92400e", fontWeight: "500" },
});

export default function AppNavigator() {
  return (
    <View style={{ flex: 1 }}>
      <AutoSync />
      <OfflineBanner />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "700" },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
          tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
        })}
      >
        <Tab.Screen
          name="Home"
          component={DashboardScreen}
          options={{ headerTitle: () => <LogoHeader /> }}
        />
        <Tab.Screen
          name="Clients"
          component={ClientsScreen}
          options={{ headerTitle: () => <LogoHeader /> }}
        />
        <Tab.Screen
          name="Policies"
          component={PoliciesStackScreen}
          options={{ headerShown: false }}
        />
        <Tab.Screen
          name="Leads"
          component={LeadsScreen}
          options={{ headerTitle: () => <LogoHeader />, title: "Quotations" }}
        />
        <Tab.Screen name="More" component={MoreStackScreen} options={{ headerShown: false }} />
      </Tab.Navigator>
    </View>
  );
}
