import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Platform,
} from "react-native";
import { colors, spacing, fontSize } from "../theme";

/**
 * Cross-platform date picker that needs no native module (works in Expo Go
 * and any build without a rebuild). Renders a tappable field; tapping opens a
 * modal with three scroll wheels (day / month / year). Value is an ISO
 * yyyy-mm-dd string so it drops straight into the existing form state and API
 * payloads that already expect that format.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseISO(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate(); // month1 is 1-based; day 0 of next month
}

interface Props {
  value: string;                  // yyyy-mm-dd or ""
  onChange: (iso: string) => void;
  placeholder?: string;
  /** Restrict selectable years. Defaults: 1900 … current year + 5. */
  minYear?: number;
  maxYear?: number;
  testID?: string;
}

export default function DateField({ value, onChange, placeholder = "Select date", minYear, maxYear, testID }: Props) {
  const now = new Date();
  const yEnd = maxYear ?? now.getFullYear() + 5;
  const yStart = minYear ?? 1900;

  const parsed = parseISO(value);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(parsed?.y ?? now.getFullYear());
  const [month, setMonth] = useState(parsed?.m ?? now.getMonth() + 1);
  const [day, setDay] = useState(parsed?.d ?? now.getDate());

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = yEnd; y >= yStart; y--) arr.push(y);
    return arr;
  }, [yStart, yEnd]);

  const dayCount = daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount]);

  const openPicker = () => {
    const p = parseISO(value);
    if (p) { setYear(p.y); setMonth(p.m); setDay(p.d); }
    setOpen(true);
  };

  const confirm = () => {
    const clampedDay = Math.min(day, daysInMonth(year, month));
    onChange(`${year}-${pad(month)}-${pad(clampedDay)}`);
    setOpen(false);
  };

  const display = parsed
    ? `${pad(parsed.d)} ${MONTHS[parsed.m - 1]} ${parsed.y}`
    : "";

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={openPicker} activeOpacity={0.7} testID={testID}>
        <Text style={[styles.fieldText, !display && styles.placeholder]}>
          {display || placeholder}
        </Text>
        <Text style={styles.cal}>📅</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.title}>Select Date</Text>
            <View style={styles.wheels}>
              <Wheel
                data={days}
                selected={day}
                format={(d) => pad(d as number)}
                onSelect={(d) => setDay(d as number)}
                label="Day"
              />
              <Wheel
                data={MONTHS.map((_, i) => i + 1)}
                selected={month}
                format={(m) => MONTHS[(m as number) - 1]}
                onSelect={(m) => setMonth(m as number)}
                label="Month"
              />
              <Wheel
                data={years}
                selected={year}
                format={(y) => String(y)}
                onSelect={(y) => setYear(y as number)}
                label="Year"
              />
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirm}>
                <Text style={styles.confirmText}>Done</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function Wheel({
  data, selected, format, onSelect, label,
}: {
  data: (number)[];
  selected: number;
  format: (v: number) => string;
  onSelect: (v: number) => void;
  label: string;
}) {
  return (
    <View style={styles.wheelCol}>
      <Text style={styles.wheelLabel}>{label}</Text>
      <ScrollView style={styles.wheel} showsVerticalScrollIndicator={false}>
        {data.map((item) => {
          const isSel = item === selected;
          return (
            <TouchableOpacity
              key={item}
              style={[styles.option, isSel && styles.optionSelected]}
              onPress={() => onSelect(item)}
            >
              <Text style={[styles.optionText, isSel && styles.optionTextSelected]}>
                {format(item)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldText: { fontSize: fontSize.md, color: colors.text },
  placeholder: { color: colors.textMuted },
  cal: { fontSize: fontSize.md },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: Platform.OS === "ios" ? spacing.xl + spacing.md : spacing.lg,
  },
  title: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, textAlign: "center", marginBottom: spacing.md },
  wheels: { flexDirection: "row", gap: spacing.sm, height: 220 },
  wheelCol: { flex: 1 },
  wheelLabel: { fontSize: fontSize.xs, fontWeight: "600", color: colors.textMuted, textAlign: "center", marginBottom: spacing.xs },
  wheel: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 10 },
  option: { paddingVertical: spacing.sm, alignItems: "center" },
  optionSelected: { backgroundColor: colors.primary + "1a" },
  optionText: { fontSize: fontSize.md, color: colors.textSecondary },
  optionTextSelected: { color: colors.primary, fontWeight: "800" },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  cancelBtn: { flex: 1, padding: spacing.md, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  cancelText: { fontSize: fontSize.md, fontWeight: "600", color: colors.textSecondary },
  confirmBtn: { flex: 1, padding: spacing.md, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center" },
  confirmText: { fontSize: fontSize.md, fontWeight: "700", color: "#fff" },
});
