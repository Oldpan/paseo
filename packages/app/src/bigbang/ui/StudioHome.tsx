// Studio's home: Paseo's open-project actions (screens/open-project-screen.tsx) in Bigbang's kit,
// above the machines' workspaces. Shown when Studio has no columns and from Studio's "+".
import { useCallback, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useImportSession } from "@/hooks/use-import-session";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useHostChooser } from "@/hosts/host-chooser";
import { useHostRuntimeLastError, useHosts } from "@/runtime/host-runtime";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { BigbangField, BigbangInput } from "./FormChrome";
import type { IconProps } from "./iconTypes";
import { BoxesIcon, CloseIcon, FolderIcon, InboxIcon, LinkIcon, WrenchIcon } from "./icons";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

export function StudioHome({
  group,
  onGroupChange,
  onClose,
  children,
}: {
  group: string;
  onGroupChange(group: string): void;
  /** Present when the home covers open columns; absent when it is Studio's empty state. */
  onClose?(): void;
  /** The machines' workspaces. */
  children: ReactNode;
}) {
  const { palette: t } = useTheme();
  const { t: translate } = useTranslation();
  const router = useRouter();
  const hosts = useHosts();
  const openProjectPicker = useOpenAddProject();
  const importSession = useImportSession();
  const chooseHost = useHostChooser();
  const localServerId = useLocalDaemonServerId();
  const [pairing, setPairing] = useState(false);
  const addProject = useCallback(() => openProjectPicker(), [openProjectPicker]);
  const openPairing = useCallback(() => setPairing(true), []);
  const closePairing = useCallback(() => setPairing(false), []);
  const openProviders = useCallback(() => {
    chooseHost({
      title: "Choose host",
      onChooseHost: (serverId) => router.push(buildSettingsHostSectionRoute(serverId, "providers")),
    });
  }, [chooseHost, router]);
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: t.chatSurface }} testID="studio-home">
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 24, alignItems: "center" }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: "100%", maxWidth: 720, gap: 20 }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <BoxesIcon color={t.brandAccent} size={28} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text role="heading" style={type(t.textPrimary, 20, { fontWeight: "700" })}>
                Your workspace, across machines
              </Text>
              <Text style={type(t.textMuted, 13)}>
                Open a workspace to work with its agents, files, changes and terminals.
              </Text>
            </View>
            {onClose ? (
              <Pressable
                role="button"
                accessibilityLabel="Close Studio home"
                onPress={onClose}
                style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
              >
                <CloseIcon color={t.textMuted} size={14} />
              </Pressable>
            ) : null}
          </View>
          {hosts.map((host) => (
            <HostError key={host.serverId} serverId={host.serverId} label={host.label} />
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <HomeAction
              icon={FolderIcon}
              title={translate("openProject.tiles.addProject.title")}
              description={translate("openProject.tiles.addProject.description")}
              onPress={addProject}
              testID="studio-home-add-project"
              accent
            />
            <HomeAction
              icon={InboxIcon}
              title={translate("openProject.tiles.importSession.title")}
              description={translate("openProject.tiles.importSession.description")}
              onPress={importSession.open}
              testID="studio-home-import-session"
            />
            <HomeAction
              icon={WrenchIcon}
              title={translate("openProject.tiles.setupProviders.title")}
              description={translate("openProject.tiles.setupProviders.description")}
              onPress={openProviders}
              testID="studio-home-setup-providers"
            />
            {localServerId ? (
              <HomeAction
                icon={LinkIcon}
                title={translate("openProject.tiles.pairDevice.title")}
                description={translate("openProject.tiles.pairDevice.description")}
                onPress={openPairing}
                testID="studio-home-pair-device"
              />
            ) : null}
          </View>
          <View style={{ gap: 10 }}>
            <WorkspacesHeader group={group} onGroupChange={onGroupChange} />
            {children}
          </View>
        </View>
      </ScrollView>
      <PairDeviceModal
        serverId={localServerId ?? ""}
        visible={pairing}
        onClose={closePairing}
        testID="studio-home-pair-device-modal"
      />
      {importSession.sheet}
    </View>
  );
}

function WorkspacesHeader({
  group,
  onGroupChange,
}: {
  group: string;
  onGroupChange(group: string): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-end" }}>
      <Text
        role="heading"
        style={type(t.textPrimary, 14, { fontWeight: "700", flex: 1, paddingBottom: 8 })}
      >
        Workspaces
      </Text>
      <View style={{ width: 200 }}>
        <BigbangField label="Studio group">
          <BigbangInput
            accessibilityLabel="Studio group"
            initialValue={group}
            onChangeText={onGroupChange}
          />
        </BigbangField>
      </View>
    </View>
  );
}

/** One machine's workspaces in the home's list. */
export function StudioMachine({
  label,
  connected,
  empty,
  children,
}: {
  label: string;
  connected: boolean;
  empty: boolean;
  children: ReactNode;
}) {
  const { palette: t } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingVertical: 4 }}>
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: connected ? t.success : t.destructive,
          }}
        />
        <Text numberOfLines={1} style={type(t.textSecondary, 11, { fontWeight: "700", flex: 1 })}>
          {label}
          {connected ? "" : " · offline"}
        </Text>
      </View>
      {empty ? (
        <Text style={type(t.textMuted, 11, { paddingVertical: 6 })}>No workspaces yet.</Text>
      ) : (
        children
      )}
    </View>
  );
}

function HostError({ serverId, label }: { serverId: string; label: string }) {
  const { palette: t } = useTheme();
  const error = useHostRuntimeLastError(serverId);
  return error ? (
    <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
      {label}: {error}
    </Text>
  ) : null;
}

function HomeAction({
  icon: Icon,
  title,
  description,
  onPress,
  testID,
  accent = false,
}: {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  onPress(): void;
  testID: string;
  accent?: boolean;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      role="button"
      accessibilityLabel={title}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexGrow: 1,
          flexBasis: 160,
          minHeight: 112,
          gap: 10,
          padding: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: pressed ? t.surfaceHover : t.surfacePrimary,
        },
        ctrlShadow(t, name),
      ]}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: accent ? t.brandAccent : t.surfaceElevated,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon color={accent ? t.onAccent : t.textSecondary} size={16} />
      </View>
      <View style={{ gap: 2 }}>
        <Text style={type(t.textPrimary, 12, { fontWeight: "700" })}>{title}</Text>
        <Text style={type(t.textMuted, 11)}>{description}</Text>
      </View>
    </Pressable>
  );
}
