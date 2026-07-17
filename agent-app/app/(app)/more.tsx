import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../src/context/AuthContext";

export default function MoreScreen() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.email}>{user?.email}</Text>
      <Pressable style={styles.button} onPress={handleSignOut} disabled={signingOut}>
        {signingOut ? <ActivityIndicator color="#A33B3B" /> : <Text style={styles.buttonText}>Sign out</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6", padding: 24 },
  email: { fontSize: 14, color: "#5B6D6B", marginBottom: 24, textAlign: "center" },
  button: { borderWidth: 1, borderColor: "#A33B3B", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#A33B3B", fontSize: 15, fontWeight: "700" },
});
