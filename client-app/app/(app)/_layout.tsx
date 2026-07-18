import { Tabs } from "expo-router";
import { Text } from "react-native";

function TabIcon({ symbol }: { symbol: string }) {
  return <Text style={{ fontSize: 20 }}>{symbol}</Text>;
}

export default function AppTabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "#0C6B62" }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: () => <TabIcon symbol="⌂" /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarIcon: () => <TabIcon symbol="$" /> }} />
      <Tabs.Screen name="claims" options={{ title: "Claims", tabBarIcon: () => <TabIcon symbol="◈" /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: () => <TabIcon symbol="⋯" /> }} />
    </Tabs>
  );
}
