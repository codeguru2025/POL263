import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { NetworkProvider } from "./src/context/NetworkContext";
import AppNavigator from "./src/navigation/AppNavigator";
import LoginScreen from "./src/screens/LoginScreen";
import ForceUpdateScreen from "./src/screens/ForceUpdateScreen";
import { useAppVersion } from "./src/hooks/useAppVersion";
import { getDb } from "./src/db/schema";
import { colors } from "./src/theme";

function RootNavigator() {
  const { user, loading } = useAuth();
  const { forceUpdate, updateAvailable, appInfo, promptUpdate } = useAppVersion();

  // Initialize database on mount
  useEffect(() => {
    getDb().catch(console.warn);
  }, []);

  // Prompt optional update once user is logged in
  useEffect(() => {
    if (user && updateAvailable && appInfo?.downloadUrl) {
      promptUpdate(appInfo.downloadUrl);
    }
  }, [user, updateAvailable]);

  if (forceUpdate && appInfo?.downloadUrl) {
    return (
      <ForceUpdateScreen
        downloadUrl={appInfo.downloadUrl}
        currentVersion={appInfo.version}
        minVersion={appInfo.minVersion}
        releaseNotes={appInfo.releaseNotes}
      />
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.primary }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer>
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <NetworkProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </NetworkProvider>
  );
}
