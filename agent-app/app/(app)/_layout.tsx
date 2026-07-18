import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useAuth } from "../../src/context/AuthContext";

/** Emoji tab icons for this bootstrap milestone — swap for a real icon set
 *  (@expo/vector-icons, already installed transitively via expo-router) once
 *  screens beyond placeholders exist. */
function TabIcon({ symbol }: { symbol: string }) {
  return <Text style={{ fontSize: 20 }}>{symbol}</Text>;
}

export default function AppTabsLayout() {
  const { isAgent } = useAuth();

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "#0C6B62" }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: () => <TabIcon symbol="⌂" /> }} />

      {/* Agent-only tabs — hidden (not unmounted, per Expo Router's href:null
          convention) rather than removed, so switching roles doesn't require
          a different route tree. */}
      <Tabs.Screen
        name="leads"
        options={{ title: "Leads", tabBarIcon: () => <TabIcon symbol="◎" />, href: isAgent ? undefined : null }}
      />
      <Tabs.Screen
        name="policies"
        options={{ title: "Policies", tabBarIcon: () => <TabIcon symbol="▤" />, href: isAgent ? undefined : null }}
      />
      <Tabs.Screen
        name="clients"
        options={{ title: "Clients", tabBarIcon: () => <TabIcon symbol="◫" />, href: isAgent ? undefined : null }}
      />
      <Tabs.Screen
        name="commissions"
        options={{ title: "Commissions", tabBarIcon: () => <TabIcon symbol="$" />, href: isAgent ? undefined : null }}
      />

      {/* Staff-only tabs */}
      <Tabs.Screen
        name="approvals"
        options={{ title: "Approvals", tabBarIcon: () => <TabIcon symbol="✓" />, href: !isAgent ? undefined : null }}
      />
      <Tabs.Screen
        name="fleet"
        options={{ title: "Fleet", tabBarIcon: () => <TabIcon symbol="▭" />, href: !isAgent ? undefined : null }}
      />

      {/* Shared */}
      <Tabs.Screen name="attendance" options={{ title: "Attendance", tabBarIcon: () => <TabIcon symbol="◷" /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: () => <TabIcon symbol="⋯" /> }} />
    </Tabs>
  );
}
