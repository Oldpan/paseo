import { StyleSheet } from "react-native-unistyles";
import { IS_PAVRA } from "@/pavra/build";

export const settingsStyles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: IS_PAVRA ? 18 : theme.spacing[6],
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: IS_PAVRA ? 8 : theme.spacing[3],
    marginLeft: IS_PAVRA ? 2 : theme.spacing[1],
  },
  sectionHeaderTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: IS_PAVRA ? 11 : theme.fontSize.sm,
    fontWeight: IS_PAVRA ? theme.fontWeight.bold : theme.fontWeight.normal,
    ...(IS_PAVRA ? { letterSpacing: 1.1, textTransform: "uppercase" as const } : null),
  },
  sectionHeaderLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
  },
  card: {
    backgroundColor: IS_PAVRA ? theme.colors.surface2 : theme.colors.surface1,
    borderRadius: IS_PAVRA ? 12 : theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: IS_PAVRA ? theme.colors.borderAccent : theme.colors.border,
    overflow: "hidden",
    ...(IS_PAVRA ? theme.chrome.controlShadow : null),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: IS_PAVRA ? 11 : theme.spacing[4],
    paddingHorizontal: IS_PAVRA ? 14 : theme.spacing[4],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  rowContent: {
    flex: 1,
    marginRight: theme.spacing[3],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: IS_PAVRA ? 13 : theme.fontSize.base,
    ...(IS_PAVRA ? { fontWeight: theme.fontWeight.semibold } : null),
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: IS_PAVRA ? 11 : theme.fontSize.sm,
    marginTop: IS_PAVRA ? 2 : theme.spacing[1],
  },
  rowError: {
    color: theme.colors.statusDanger,
    fontSize: IS_PAVRA ? 11 : theme.fontSize.sm,
    marginTop: IS_PAVRA ? 2 : theme.spacing[1],
  },
}));
