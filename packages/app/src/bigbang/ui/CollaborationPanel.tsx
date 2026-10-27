// Studio collaboration side panel: members, linked assistants and the Records history.
import { ScrollView, Text, View } from "react-native";
import type { RecordRow } from "../peer-activity";
import { Chip } from "./ChatChrome";
import { text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface CollaborationToggle {
  key: string;
  label: string;
  detail?: string;
  on: boolean;
  onToggle(): void;
}

export function CollaborationPanel({
  group,
  enabled,
  onEnable,
  workspaces,
  assistants,
  records,
  error,
  busy,
  onClose,
  width,
}: {
  group: string;
  enabled: boolean;
  onEnable(): void;
  workspaces: CollaborationToggle[];
  assistants: CollaborationToggle[];
  records: RecordRow[];
  error: string | null;
  busy: boolean;
  onClose(): void;
  width: number | "100%";
}) {
  const { palette: t } = useTheme();
  const heading = type(t.textPrimary, 12, { fontWeight: "700", marginTop: 12 });
  return (
    <View
      accessibilityLabel="Studio collaboration"
      style={{
        width,
        borderLeftWidth: 2,
        borderLeftColor: t.black,
        backgroundColor: t.surfacePrimary,
        minHeight: 0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12 }}>
        <Text style={type(t.textPrimary, 14, { fontWeight: "700", flex: 1 })}>
          Collaboration · {group}
        </Text>
        <Chip onPress={onClose}>Close</Chip>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
      >
        {error ? (
          <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
            {error}
          </Text>
        ) : null}
        {!enabled ? (
          <View style={{ gap: 8 }}>
            <Text style={type(t.textSecondary, 12)}>
              {
                "Once this group collaborates, agents in its workspaces can message each other across machines."
              }
            </Text>
            <Chip onPress={onEnable} disabled={busy}>
              Enable collaboration
            </Chip>
          </View>
        ) : (
          <View>
            <Text style={heading}>Workspaces</Text>
            {workspaces.map((item) => (
              <ToggleRow key={item.key} item={item} busy={busy} on="In Studio" off="Join" />
            ))}
            <Text style={heading}>Assistants members can reach</Text>
            {assistants.map((item) => (
              <ToggleRow key={item.key} item={item} busy={busy} on="Linked" off="Link" />
            ))}
            <Text style={heading}>Records</Text>
            {records.length === 0 ? (
              <Text style={type(t.textMuted, 12)}>No messages yet.</Text>
            ) : null}
            {records.map((row) => (
              <View
                key={row.id}
                style={{
                  marginTop: 6,
                  marginLeft: row.depth * 14,
                  paddingLeft: 8,
                  borderLeftWidth: 2,
                  borderLeftColor: row.depth ? t.retroBorderLight : t.brandAccent,
                  gap: 2,
                }}
              >
                <Text style={type(t.textSecondary, 11, { fontWeight: "700" })}>{row.route}</Text>
                <Text style={type(t.textMuted, 11)}>
                  {row.kind} · {row.status}
                  {row.detail ? ` · ${row.detail}` : ""}
                </Text>
                <Text numberOfLines={3} style={type(t.textPrimary, 12)}>
                  {row.text}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ToggleRow({
  item,
  busy,
  on,
  off,
}: {
  item: CollaborationToggle;
  busy: boolean;
  on: string;
  off: string;
}) {
  const { palette: t } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={type(t.textPrimary, 12)}>
          {item.label}
        </Text>
        {item.detail ? (
          <Text numberOfLines={1} style={type(t.textMuted, 11)}>
            {item.detail}
          </Text>
        ) : null}
      </View>
      <Chip onPress={item.onToggle} disabled={busy} accent={item.on}>
        {item.on ? on : off}
      </Chip>
    </View>
  );
}
