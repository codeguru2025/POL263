import React, { useEffect, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { NetworkProvider } from "./src/context/NetworkContext";
import AppNavigator from "./src/navigation/AppNavigator";
import LoginScreen from "./src/screens/LoginScreen";
import ForceUpdateScreen from "./src/screens/ForceUpdateScreen";
import ClientPortalScreen from "./src/screens/ClientPortalScreen";
import { useAppVersion } from "./src/hooks/useAppVersion";
import { getDb } from "./src/db/schema";
import { colors } from "./src/theme";

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { user, loading } = useAuth();
  const { forceUpdate, updateAvailable, appInfo, promptUpdate } = useAppVersion();

  useEffect(() => {
    getDb().catch(console.warn);
  }, []);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

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

  if (user.role === "client") {
    return <ClientPortalScreen />;
  }

  return (
    <NavigationContainer>
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  const notifListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    // Show alert when a push arrives while app is foregrounded
    notifListener.current = Notifications.addNotificationReceivedListener((_notif) => {
      // NotificationContext's SSE already updates badge + inbox in real time.
      // No additional action needed for foreground — the in-app toast from
      // setNotificationHandler (shouldShowAlert: true) handles display.
    });

    // Navigate or refresh when user taps a push notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      // Deep-link: the NotificationContext will refresh on next foreground event.
      // For now, log the tap — extend here to navigate to specific screens.
      if (__DEV__) console.log("[Push tapped]", data);
    });

    return () => {
      notifListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <NetworkProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
        </AuthProvider>
      </NetworkProvider>
    </SafeAreaProvider>
  );
}
