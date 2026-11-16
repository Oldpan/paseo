// Studio collaboration side panel: Summary digest, members, linked assistants and Records history.
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { buildStudioGroupSummary, type StudioGroupSummary } from "../model";
import type { RecordRow } from "../peer-activity";
import { Chip } from "./ChatChrome";
import { copyText } from "./clipboard";
import { CheckIcon, CopyIcon, RefreshIcon } from "./icons";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface CollaborationToggle {
  key: string;
  label: string;
  detail?: string;
  on: boolean;
  onToggle(): void;
}

export type CollaborationTab = "summary" | "activity";

export function CollaborationPanel({
  group,
  enabled,
  onEnable,
  workspaces,
  assistants,
  records,
  summary: summaryProp,
  onRefreshSummary,
  initialTab = "summary",
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
  summary?: StudioGroupSummary;
  onRefreshSummary?(): void;
  initialTab?: CollaborationTab;
  error: string | null;
  busy: boolean;
  onClose(): void;
  width: number | "100%";
}) {
  const { palette: t, name } = useTheme();
  const [tab, setTab] = useState<CollaborationTab>(initialTab);
  const [copied, setCopied] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const heading = type(t.textPrimary, 12, { fontWeight: "700", marginTop: 12 });

  const fallbackSummary = useMemo<StudioGroupSummary>(() => {
    void refreshCount;
    return buildStudioGroupSummary({
      group,
      columns: workspaces.map((ws) => ({
        serverId: ws.detail ?? "local",
        workspaceId: ws.key,
        name: ws.label,
        group,
      })),
      assistants: assistants
        .filter((item) => item.on)
        .map((item) => ({
          id: item.key,
          name: item.label,
          provider: "default/model",
          persona: "",
        })),
      studioRecords: records,
    });
  }, [assistants, group, records, refreshCount, workspaces]);

  const summary = summaryProp ?? fallbackSummary;

  const handleRefresh = () => {
    setRefreshCount((prev) => prev + 1);
    onRefreshSummary?.();
  };

  const handleCopyDigest = () => {
    void copyText(summary.markdownDigest).then((status) => {
      if (status === "copied") {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
      return null;
    });
  };

  return (
    <View
      accessibilityLabel="Studio collaboration"
      style={{
        width,
        maxWidth: "100%",
        ...(width === "100%"
          ? {
              position: "absolute" as const,
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              zIndex: 20,
              borderLeftWidth: 0,
            }
          : {
              borderLeftWidth: 2,
              borderLeftColor: t.black,
            }),
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
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          paddingHorizontal: 12,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: t.retroBorderLight,
        }}
      >
        <Pressable
          testID="studio-collab-tab-summary"
          role="button"
          accessibilityLabel="Summary"
          accessibilityState={{ selected: tab === "summary" }}
          onPress={() => setTab("summary")}
          style={[
            {
              height: 28,
              paddingHorizontal: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: tab === "summary" ? t.brandAccent : t.surfaceElevated,
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          <Text
            style={type(tab === "summary" ? t.onAccent : t.textSecondary, 11, {
              fontWeight: "700",
            })}
          >
            Summary
          </Text>
        </Pressable>
        <Pressable
          testID="studio-collab-tab-activity"
          role="button"
          accessibilityLabel="Activity & Peers"
          accessibilityState={{ selected: tab === "activity" }}
          onPress={() => setTab("activity")}
          style={[
            {
              height: 28,
              paddingHorizontal: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: tab === "activity" ? t.brandAccent : t.surfaceElevated,
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          <Text
            style={type(tab === "activity" ? t.onAccent : t.textSecondary, 11, {
              fontWeight: "700",
            })}
          >
            Activity & Peers
          </Text>
        </Pressable>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16 }}
      >
        {error ? (
          <Text accessibilityRole="alert" style={type(t.destructive, 12, { marginBottom: 8 })}>
            {error}
          </Text>
        ) : null}
        {tab === "summary" ? (
          <StudioSummaryTabView
            summary={summary}
            enabled={enabled}
            busy={busy}
            copied={copied}
            onEnable={onEnable}
            onRefresh={handleRefresh}
            onCopyDigest={handleCopyDigest}
          />
        ) : !enabled ? (
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

function StudioSummaryTabView({
  summary,
  enabled,
  busy,
  copied,
  onEnable,
  onRefresh,
  onCopyDigest,
}: {
  summary: StudioGroupSummary;
  enabled: boolean;
  busy: boolean;
  copied: boolean;
  onEnable(): void;
  onRefresh(): void;
  onCopyDigest(): void;
}) {
  const { palette: t, name } = useTheme();
  const sectionHeading = type(t.textPrimary, 12, { fontWeight: "700", marginTop: 12 });
  return (
    <View testID="studio-summary-panel" style={{ gap: 10 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={type(t.textPrimary, 12, { fontWeight: "700" })}>
            {`Group Digest · ${summary.group}`}
          </Text>
          <Text style={type(t.textMuted, 10)}>
            {`${summary.workspaceCount} workspaces · ${summary.assistantCount} assistants · ${summary.recordCount} records`}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Pressable
            testID="studio-summary-refresh"
            role="button"
            accessibilityLabel="Refresh Summary"
            disabled={busy}
            onPress={onRefresh}
            style={[
              {
                height: 26,
                paddingHorizontal: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.surfaceElevated,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                opacity: busy ? 0.5 : 1,
              },
              ctrlShadow(t, name),
            ]}
          >
            <RefreshIcon color={t.textSecondary} size={11} />
            <Text style={type(t.textPrimary, 10, { fontWeight: "600" })}>Refresh</Text>
          </Pressable>
          <Pressable
            testID="studio-summary-copy"
            role="button"
            accessibilityLabel={copied ? "Copied Digest" : "Copy Digest"}
            onPress={onCopyDigest}
            style={[
              {
                height: 26,
                paddingHorizontal: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: copied ? t.brandAccentSoft : t.surfaceElevated,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              },
              ctrlShadow(t, name),
            ]}
          >
            {copied ? (
              <CheckIcon color={t.success} size={11} />
            ) : (
              <CopyIcon color={t.textSecondary} size={11} />
            )}
            <Text style={type(t.textPrimary, 10, { fontWeight: "600" })}>
              {copied ? "Copied" : "Copy Digest"}
            </Text>
          </Pressable>
        </View>
      </View>

      {!enabled ? (
        <View
          style={{
            padding: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfaceSecondary,
            gap: 6,
          }}
        >
          <Text style={type(t.textSecondary, 11)}>
            Once this group collaborates, agents in its workspaces can message each other across
            machines.
          </Text>
          <View style={{ alignSelf: "flex-start" }}>
            <Chip onPress={onEnable} disabled={busy}>
              Enable collaboration
            </Chip>
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <SummaryStatCard label="Workspaces" value={String(summary.workspaceCount)} />
        <SummaryStatCard label="Assistants" value={String(summary.assistantCount)} />
        <SummaryStatCard
          label="Tasks"
          value={`${summary.activeTaskCount} active / ${summary.completedTaskCount} done`}
        />
        <SummaryStatCard label="Peer Records" value={String(summary.recordCount)} />
      </View>

      <Text style={sectionHeading}>Workspaces across machines</Text>
      {summary.workspaces.length === 0 ? (
        <Text style={type(t.textMuted, 11)}>No workspaces in this group yet.</Text>
      ) : (
        summary.workspaces.map((ws) => (
          <View
            key={ws.key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 4,
              borderBottomWidth: 1,
              borderBottomColor: t.dividerLine,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={type(t.textPrimary, 12, { fontWeight: "600" })}>
                {ws.name}
              </Text>
              <Text numberOfLines={1} style={type(t.textMuted, 10)}>
                {ws.machineLabel}
              </Text>
            </View>
            <Text
              style={type(ws.bound ? t.brandAccent : t.textSecondary, 10, { fontWeight: "700" })}
            >
              {ws.bound ? "Bound" : "Open"}
            </Text>
          </View>
        ))
      )}

      <Text style={sectionHeading}>Collaborating assistants</Text>
      {summary.assistants.length === 0 ? (
        <Text style={type(t.textMuted, 11)}>No collaborating assistants linked yet.</Text>
      ) : (
        summary.assistants.map((assistant) => (
          <View
            key={assistant.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 4,
              borderBottomWidth: 1,
              borderBottomColor: t.dividerLine,
            }}
          >
            <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>{assistant.name}</Text>
            <Text style={type(t.textMuted, 10)}>
              {assistant.activeTurnCount > 0
                ? `${assistant.activeTurnCount} active ${assistant.activeTurnCount === 1 ? "turn" : "turns"}`
                : (assistant.provider ?? "Linked")}
            </Text>
          </View>
        ))
      )}

      <Text style={sectionHeading}>Highlights</Text>
      {summary.highlights.length === 0 ? (
        <Text style={type(t.textMuted, 11)}>No recent peer exchanges or task highlights.</Text>
      ) : (
        summary.highlights.map((item, idx) => (
          <View
            key={`${idx}-${item}`}
            style={{
              paddingLeft: 8,
              borderLeftWidth: 2,
              borderLeftColor: t.brandAccent,
              marginTop: 2,
            }}
          >
            <Text style={type(t.textPrimary, 11)}>{item}</Text>
          </View>
        ))
      )}

      <View
        testID="studio-summary-body"
        style={{
          marginTop: 6,
          padding: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfaceSecondary,
        }}
      >
        <Text style={type(t.textSecondary, 11)}>{summary.markdownDigest}</Text>
      </View>
    </View>
  );
}

function SummaryStatCard({ label, value }: { label: string; value: string }) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{
        minWidth: 130,
        flexGrow: 1,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: t.retroBorderLight,
        backgroundColor: t.surfaceElevated,
      }}
    >
      <Text style={type(t.textMuted, 10, { fontWeight: "600" })}>{label}</Text>
      <Text style={type(t.textPrimary, 13, { fontWeight: "700", marginTop: 2 })}>{value}</Text>
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
