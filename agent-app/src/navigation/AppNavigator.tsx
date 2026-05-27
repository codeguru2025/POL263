import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Text, View, StyleSheet, Image, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DashboardScreen from "../screens/DashboardScreen";
import ClientsScreen from "../screens/ClientsScreen";
import PoliciesScreen from "../screens/PoliciesScreen";
import CreatePolicyScreen from "../screens/CreatePolicyScreen";
import LeadsScreen from "../screens/LeadsScreen";
import CommissionsScreen from "../screens/CommissionsScreen";
import PaymentsScreen from "../screens/PaymentsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import { colors, fontSize } from "../theme";
import { useNetwork } from "../context/NetworkContext";
import AutoSync from "../sync/AutoSync";

const Tab = createBottomTabNavigator();
const PolicyStack = createNativeStackNavigator();
const MoreStack = createNativeStackNavigator();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: "🏠",
    Clients: "👥",
    Policies: "📋",
    Leads: "🎯",
    More: "☰",
  };
  return (
    <View style={tabStyles.icon}>
      <Text style={{ fontSize: 20 }}>{icons[label] || "📄"}</Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  icon: { alignItems: "center", justifyContent: "center" },
});

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

function MoreMenuScreen({ navigation }: any) {
  const menuItems = [
    { label: "Commissions", icon: "💰", screen: "Commissions", desc: "View your commission earnings" },
    { label: "Payments", icon: "💵", screen: "Payments", desc: "Payments on your policies" },
    { label: "Settings", icon: "⚙️", screen: "SettingsDetail", desc: "Sync, profile, and logout" },
  ];

  return (
    <SafeAreaView style={moreStyles.safeArea} edges={["top"]}>
      <Image source={require("../../assets/logo.png")} style={moreStyles.logo} resizeMode="contain" />
      {menuItems.map(item => (
        <TouchableOpacity key={item.screen} style={moreStyles.item} onPress={() => navigation.navigate(item.screen)}>
          <Text style={moreStyles.icon}>{item.icon}</Text>
          <View style={moreStyles.textCol}>
            <Text style={moreStyles.label}>{item.label}</Text>
            <Text style={moreStyles.desc}>{item.desc}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </SafeAreaView>
  );
}

const moreStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background, padding: 16 },
  logo: { width: 140, height: 40, alignSelf: "center", marginBottom: 16 },
  item: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surface,
    borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  icon: { fontSize: 24, marginRight: 14 },
  textCol: { flex: 1 },
  label: { fontSize: 16, fontWeight: "600", color: colors.text },
  desc: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
});

function MoreStackScreen() {
  return (
    <MoreStack.Navigator>
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ headerShown: false }} />
      <MoreStack.Screen name="Commissions" component={CommissionsScreen}
        options={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.primary, headerTitleStyle: { fontWeight: "700" } }} />
      <MoreStack.Screen name="Payments" component={PaymentsScreen}
        options={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.primary, headerTitleStyle: { fontWeight: "700" } }} />
      <MoreStack.Screen name="SettingsDetail" component={SettingsScreen}
        options={{ title: "Settings", headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.primary, headerTitleStyle: { fontWeight: "700" } }} />
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
