import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "../src/context/AuthContext";

SplashScreen.preventAutoHideAsync().catch(() => {});

function SplashScreenController() {
  const { isLoading } = useAuth();
  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync().catch(() => {});
  }, [isLoading]);
  return null;
}

function RootNavigator() {
  const { client } = useAuth();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!client}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!client}>
        <Stack.Screen name="login" />
        <Stack.Screen name="enroll" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SplashScreenController />
      <RootNavigator />
    </AuthProvider>
  );
}
