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
import { colors, fontSize } from "../theme";
import { useNetwork } from "../context/NetworkContext";
import AutoSync from "../sync/AutoSync";

const Tab = createBottomTabNavigator();
const PolicyStack = createNativeStackNavigator();
const MoreStack = createNativeStackNavigator();

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

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

const MORE_MENU: { label: string; icon: IoniconName; screen: string; desc: string; color: string }[] = [
  { label: "Claims",        icon: "medkit-outline",            screen: "Claims",       desc: "Submit and track claims",        color: "#e11d48" },
  { label: "Commissions",   icon: "cash-outline",              screen: "Commissions",  desc: "View your commission earnings",  color: "#16a34a" },
  { label: "Payments",      icon: "card-outline",              screen: "Payments",     desc: "Payment records",               color: "#2563eb" },
  { label: "Reports",       icon: "bar-chart-outline",         screen: "Reports",      desc: "Key metrics and performance",   color: "#7c3aed" },
  { label: "Groups",        icon: "people-circle-outline",     screen: "Groups",       desc: "Group policy management",       color: "#0891b2" },
  { label: "Approvals",     icon: "checkmark-circle-outline",  screen: "Approvals",    desc: "Pending approval requests",     color: "#d97706" },
  { label: "Notifications", icon: "notifications-outline",     screen: "Notifications",desc: "System notifications",          color: "#9333ea" },
  { label: "Settings",      icon: "settings-outline",          screen: "SettingsDetail",desc: "Sync, profile, and logout",    color: "#475569" },
];

function MoreMenuScreen({ navigation }: any) {
  return (
    <SafeAreaView style={moreStyles.safeArea} edges={["top"]}>
      <Image source={require("../../assets/logo.png")} style={moreStyles.logo} resizeMode="contain" />
      <ScrollView>
        {MORE_MENU.map(item => (
          <TouchableOpacity key={item.screen} style={moreStyles.item} onPress={() => navigation.navigate(item.screen)}>
            <View style={[moreStyles.iconWrap, { backgroundColor: item.color + "18" }]}>
              <Ionicons name={item.icon} size={22} color={item.color} />
            </View>
            <View style={moreStyles.textCol}>
              <Text style={moreStyles.label}>{item.label}</Text>
              <Text style={moreStyles.desc}>{item.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const moreStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  logo: { width: 140, height: 40, alignSelf: "center", marginBottom: 16, marginTop: 8 },
  item: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surface,
    marginHorizontal: 16, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  textCol: { flex: 1 },
  label: { fontSize: 15, fontWeight: "600", color: colors.text },
  desc: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});

const navOpts = { headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.primary, headerTitleStyle: { fontWeight: "700" as const } };

function MoreStackScreen() {
  return (
    <MoreStack.Navigator>
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ headerShown: false }} />
      <MoreStack.Screen name="Claims" component={ClaimsScreen} options={{ title: "Claims", ...navOpts }} />
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
        <Tab.Screen name="Home" component={DashboardScreen} options={{ title: "Dashboard" }} />
        <Tab.Screen name="Clients" component={ClientsScreen} />
        <Tab.Screen
          name="Policies"
          component={PoliciesStackScreen}
          options={{ headerShown: false }}
        />
        <Tab.Screen name="Leads" component={LeadsScreen} options={{ title: "Quotations" }} />
        <Tab.Screen name="More" component={MoreStackScreen} options={{ headerShown: false }} />
      </Tab.Navigator>
    </View>
  );
}
