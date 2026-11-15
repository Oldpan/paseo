import { Pressable, Text, View } from "react-native";
import {
  formatProvenanceLabel,
  type ConsultedPeer,
  type TurnProvenanceSummary,
} from "../peer-activity";
import { BriefcaseIcon, ChevronIcon, MessagesSquareIcon, MonitorIcon } from "./icons";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export { formatProvenanceLabel };
export type { ConsultedPeer, TurnProvenanceSummary };

export interface ProvenanceChipProps {
  /** Compact provenance descriptor from `buildTurnLineage`. */
  provenance?: TurnProvenanceSummary | null;
  /** Optional direct peer list override when `provenance` is not passed as an object. */
  consultedPeers?: readonly ConsultedPeer[];
  /** Optional direct task count override when `provenance` is not passed as an object. */
  taskCount?: number;
  /** Optional direct takeover count override when `provenance` is not passed as an object. */
  takeoverCount?: number;
  /** Opens `TurnProcessDrawer` for the turn/message when clicked. */
  onPress?: () => void;
  testID?: string;
}

const CHIP_ROW = {
  marginTop: 6,
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
} as const;

const CHIP_BASE = {
  minHeight: 26,
  borderRadius: 999,
  borderWidth: 1,
  paddingHorizontal: 10,
  paddingVertical: 3,
  flexDirection: "row",
  alignItems: "center",
  gap: 5,
} as const;

function renderLeadingIcon(hasPeers: boolean, hasTasks: boolean, color: string) {
  if (hasPeers) return <MessagesSquareIcon color={color} size={12} />;
  if (hasTasks) return <BriefcaseIcon color={color} size={12} />;
  return <MonitorIcon color={color} size={12} />;
}

export function ProvenanceChip({
  provenance,
  consultedPeers,
  taskCount,
  takeoverCount,
  onPress,
  testID = "provenance-chip",
}: ProvenanceChipProps) {
  const { palette: t, name } = useTheme();
  const resolvedPeers = provenance?.consultedPeers ?? consultedPeers ?? [];
  const resolvedTasks = provenance?.taskCount ?? taskCount ?? 0;
  const resolvedTakeovers = provenance?.takeoverCount ?? takeoverCount ?? 0;

  if (resolvedPeers.length === 0 && resolvedTasks <= 0 && resolvedTakeovers <= 0) {
    return null;
  }

  const label = formatProvenanceLabel({
    consultedPeers: [...resolvedPeers],
    taskCount: resolvedTasks,
    takeoverCount: resolvedTakeovers,
  });
  if (!label) return null;

  const leadingIcon = renderLeadingIcon(
    resolvedPeers.length > 0,
    resolvedTasks > 0,
    t.textSecondary,
  );

  return (
    <View style={CHIP_ROW}>
      <Pressable
        testID={testID}
        role="button"
        accessibilityLabel={`${label}. View process`}
        disabled={!onPress}
        onPress={onPress}
        style={(state) => {
          const hovered = Boolean((state as { hovered?: boolean }).hovered);
          return [
            CHIP_BASE,
            {
              borderColor: t.retroBorder,
              backgroundColor: hovered && onPress ? t.surfaceHover : t.surfaceElevated,
              ...webTransition("background-color 120ms ease"),
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        {leadingIcon}
        <Text numberOfLines={1} style={type(t.textSecondary, 11, { fontWeight: "700" })}>
          {label}
        </Text>
        {onPress ? <ChevronIcon color={t.textMuted} size={11} down={false} /> : null}
      </Pressable>
    </View>
  );
}
