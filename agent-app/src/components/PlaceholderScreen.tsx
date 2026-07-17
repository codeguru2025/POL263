import { StyleSheet, Text, View } from "react-native";

export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>Not built yet — this milestone only proves auth and navigation.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6F6", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 18, fontWeight: "700", color: "#14201F", marginBottom: 8 },
  note: { fontSize: 13, color: "#8A9997", textAlign: "center" },
});
