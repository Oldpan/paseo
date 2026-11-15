import { useHardwareKeyboardPresent } from "@/keyboard";
import { useAddHost } from "@/hosts/add-host";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router/react-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Buffer } from "buffer";
import {
  ArrowLeft,
  Settings,
  Palette,
  Server,
  Network,
  Bot,
  Boxes,
  Gauge,
  Keyboard,
  Stethoscope,
  Info,
  Bell,
  Shield,
  Puzzle,
  Plus,
  FolderGit2,
  SquareTerminal,
  Code2,
  Files,
  Smartphone,
  Sparkles,
  Mic,
  Blocks,
  Globe,
  PanelLeft,
  MessageSquare,
  ChevronRight,
} from "lucide-react-native";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { HostPicker as SharedHostPicker } from "@/components/hosts/host-picker";
import { HostStatusDot } from "@/components/host-status-dot";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { AppearanceSection } from "@/screens/settings/appearance/appearance-section";
import { OpenLocationSection } from "@/screens/settings/open-location/open-location-section";
import { TerminalSection } from "@/screens/settings/terminal/terminal-section";
import { ChatSection } from "@/screens/settings/chat/chat-section";
import { SidebarNavSection } from "@/screens/settings/sidebar/sidebar-nav-section";
import { SendingSection } from "@/screens/settings/general/sending-section";
import {
  useAppSettings,
  useSettings,
  type AppSettings,
  type Settings as EffectiveSettings,
} from "@/hooks/use-settings";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  orderHostsLocalFirst,
  resolveActiveHostServerId,
  type HostProfile,
} from "@/types/host-connection";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { WindowChromeRegion, WindowChromeSafeArea } from "@/utils/desktop-window";
import { confirmDialog } from "@/utils/confirm-dialog";
import { BackHeader } from "@/components/headers/back-header";
import { PageLayout } from "@/components/page-layout";
import { KeyboardShortcutsSection } from "@/screens/settings/keyboard-shortcuts-section";
import { EditorSection } from "@/screens/settings/editor-section";
import { FilesSection } from "@/screens/settings/files-section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CommunityLinks } from "@/components/community-links";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DesktopPermissionsSection } from "@/desktop/components/desktop-permissions-section";
import { DesktopNotificationsSection } from "@/desktop/components/desktop-notifications-section";
import { BrowserDataSection } from "@/desktop/browser/settings/browser-data-section";
import { IntegrationsSection } from "@/desktop/components/integrations-section";
import { isElectronRuntime } from "@/desktop/host";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { openChangelog } from "@/changelog";
import { useAppDiagnosticStore } from "@/diagnostics/store";
import { settingsStyles } from "@/styles/settings";
import { THINKING_TONE_NATIVE_PCM_BASE64 } from "@/utils/thinking-tone.native-pcm";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import {
  LANGUAGE_OPTIONS,
  formatLanguageOptionLabel,
  parseAppLanguage,
  type AppLanguage,
  type SupportedLocale,
} from "@/i18n/locales";
import {
  HostConnectionsPage,
  HostPairDevicePage,
  HostAgentsPage,
  HostSettingsPage,
  HostProvidersPage,
  HostUsagePage,
  HostWorkspacesPage,
  HostTerminalsPage,
} from "@/screens/settings/host-page";
import { PluginSettingsContent } from "@/plugins/settings";
import { usePluginDisplayName } from "@/plugins/plugin-list";
import { HostPluginsPage } from "@/screens/settings/plugins-page";
import { MetadataGenerationPage } from "@/screens/settings/metadata-generation-page";
import { HostVoicePage } from "@/screens/settings/voice/voice-page";
import ProjectsScreen from "@/screens/projects-screen";
import ProjectSettingsScreen from "@/screens/project-settings-screen";
import {
  SETTINGS_DESKTOP_DETAIL_MIN_WIDTH,
  SETTINGS_DESKTOP_SIDEBAR_WIDTH,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { density, densityIconBox, densityIconSize } from "@/styles/density";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import {
  type EnableBuiltInDaemonOption,
  useEnableBuiltInDaemonOption,
} from "@/desktop/hooks/use-enable-built-in-daemon-option";
import {
  buildSettingsHostSectionRoute,
  buildSettingsSectionRoute,
  type HostSectionSlug,
  type SettingsSectionSlug,
} from "@/utils/host-routes";
import {
  selectSettingsHost,
  useSettingsHostSelection,
  useSettingsSidebarScroll,
} from "@/navigation/settings-presentation";
import { returnFromSettings, type SettingsView } from "@/navigation/settings-navigation";
import { isNative, isWeb } from "@/constants/platform";
import { useOpenOnboarding } from "@/onboarding";
import { IS_PAVRA } from "@/pavra/build";
import { usePavraData } from "@/pavra/data";
import { resolveDefaultCoordinatorId } from "@/pavra/model";
import { PavraPage } from "@/pavra/page-frame";
import { usePavraView } from "@/pavra/store";
import {
  type ApkUpdateCheckPhase,
  type ApkUpdateTaskPhase,
  isAndroidApkUpdateSupported,
  usePavraApkUpdater,
  usePavraApkUpdaterStore,
} from "@/pavra/use-pavra-apk-updater";
import { ApkUpdateSheet } from "@/pavra/ui/ApkUpdateSheet";

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

interface SidebarSectionItem {
  id: SettingsSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  desktopOnly?: boolean;
  webOnly?: boolean;
  hardwareKeyboardOnly?: boolean;
  /** The page body, for pages that need nothing from the settings screen. */
  Content?: ComponentType;
}

const SIDEBAR_SECTION_ITEMS: SidebarSectionItem[] = [
  { id: "general", labelKey: "settings.sections.general", icon: Settings },
  {
    id: "appearance",
    labelKey: "settings.sections.appearance",
    icon: Palette,
    Content: AppearanceSection,
  },
  {
    id: "sidebar",
    labelKey: "settings.sections.sidebar",
    icon: PanelLeft,
    Content: SidebarNavSection,
  },
  { id: "chat", labelKey: "settings.sections.chat", icon: MessageSquare, Content: ChatSection },
  {
    id: "terminal",
    labelKey: "settings.sections.terminal",
    icon: SquareTerminal,
    Content: TerminalSection,
  },
  {
    id: "browser",
    labelKey: "settings.sections.browser",
    icon: Globe,
    desktopOnly: true,
    Content: BrowserDataSection,
  },
  {
    id: "editor",
    labelKey: "settings.sections.editor",
    icon: Code2,
    webOnly: true,
    Content: EditorSection,
  },
  { id: "files", labelKey: "settings.sections.files", icon: Files, Content: FilesSection },
  {
    id: "shortcuts",
    labelKey: "settings.sections.shortcuts",
    icon: Keyboard,
    hardwareKeyboardOnly: true,
    Content: KeyboardShortcutsSection,
  },
  {
    id: "integrations",
    labelKey: "settings.sections.integrations",
    icon: Puzzle,
    desktopOnly: true,
    Content: IntegrationsSection,
  },
  {
    id: "notifications",
    labelKey: "settings.sections.notifications",
    icon: Bell,
    desktopOnly: true,
    Content: DesktopNotificationsSection,
  },
  {
    id: "permissions",
    labelKey: "settings.sections.permissions",
    icon: Shield,
    desktopOnly: true,
    Content: DesktopPermissionsSection,
  },
  { id: "diagnostics", labelKey: "settings.sections.diagnostics", icon: Stethoscope },
  { id: "about", labelKey: "settings.sections.about", icon: Info },
];

function isSectionAvailable(
  item: SidebarSectionItem,
  isDesktopApp: boolean,
  hardwareKeyboardPresent: boolean,
): boolean {
  if (item.hardwareKeyboardOnly && !hardwareKeyboardPresent) return false;
  return (!item.desktopOnly || isDesktopApp) && (!item.webOnly || isWeb);
}

interface HostSectionItem {
  id: HostSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
}

const HOST_SECTION_ITEMS: HostSectionItem[] = [
  { id: "host", labelKey: "settings.hostSections.host", icon: Server },
  { id: "projects", labelKey: "settings.hostSections.projects", icon: FolderGit2 },
  { id: "connections", labelKey: "settings.hostSections.connections", icon: Network },
  { id: "pair-device", labelKey: "openProject.tiles.pairDevice.title", icon: Smartphone },
  { id: "agents", labelKey: "settings.hostSections.agents", icon: Bot },
  { id: "metadata", labelKey: "settings.hostSections.metadata", icon: Sparkles },
  { id: "voice", labelKey: "settings.hostSections.voice", icon: Mic },
  { id: "workspaces", labelKey: "settings.hostSections.workspaces", icon: FolderGit2 },
  { id: "providers", labelKey: "settings.hostSections.providers", icon: Boxes },
  { id: "usage", labelKey: "settings.hostSections.usage", icon: Gauge },
  { id: "terminals", labelKey: "settings.hostSections.terminals", icon: SquareTerminal },
  { id: "plugins", labelKey: "settings.hostSections.plugins", icon: Blocks },
];

function renderHostSettingsContent(
  view: Extract<SettingsView, { kind: "host" }>,
  onHostRemoved: () => void,
): ReactNode {
  switch (view.section) {
    case "projects":
      return <ProjectsScreen serverId={view.serverId} />;
    case "connections":
      return <HostConnectionsPage serverId={view.serverId} />;
    case "pair-device":
      return <HostPairDevicePage serverId={view.serverId} />;
    case "agents":
      return <HostAgentsPage serverId={view.serverId} />;
    case "metadata":
      return <MetadataGenerationPage serverId={view.serverId} />;
    case "voice":
      return <HostVoicePage serverId={view.serverId} />;
    case "workspaces":
      return <HostWorkspacesPage serverId={view.serverId} />;
    case "providers":
      return <HostProvidersPage serverId={view.serverId} />;
    case "usage":
      return <HostUsagePage serverId={view.serverId} />;
    case "terminals":
      return <HostTerminalsPage serverId={view.serverId} />;
    case "plugins":
      return <HostPluginsPage serverId={view.serverId} />;
    case "host":
      return <HostSettingsPage serverId={view.serverId} onHostRemoved={onHostRemoved} />;
  }
}

// ---------------------------------------------------------------------------
// Trigger + sidebar style helpers
// ---------------------------------------------------------------------------

function sidebarItemStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    Boolean(hovered) && sidebarStyles.itemHovered,
    pressed && sidebarStyles.itemPressed,
  ];
}

function selectedSidebarItemStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    Boolean(hovered) && sidebarStyles.itemHovered,
    sidebarStyles.itemSelected,
    pressed && sidebarStyles.itemPressed,
  ];
}

function getActiveLocale(language: string | undefined): SupportedLocale {
  const parsed = parseAppLanguage(language);
  return parsed && parsed !== "system" ? parsed : "en";
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

interface GeneralSectionProps {
  settings: AppSettings;
  handleLanguageChange: (language: AppLanguage) => void;
}

interface LanguageMenuItemProps {
  value: AppLanguage;
  activeLocale: SupportedLocale;
  selected: boolean;
  onChange: (value: AppLanguage) => void;
}

function LanguageMenuItem({ value, activeLocale, selected, onChange }: LanguageMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  const option = LANGUAGE_OPTIONS.find((entry) => entry.value === value);
  const label = option
    ? formatLanguageOptionLabel(option, activeLocale, t(option.labelKey))
    : value;

  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function GeneralSection({ settings, handleLanguageChange }: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const activeLocale = getActiveLocale(i18n.language);
  const selectedLanguageOption = LANGUAGE_OPTIONS.find(
    (option) => option.value === settings.language,
  );
  const selectedLanguageLabel = selectedLanguageOption
    ? formatLanguageOptionLabel(
        selectedLanguageOption,
        activeLocale,
        t(selectedLanguageOption.labelKey),
      )
    : settings.language;
  return (
    <SettingsSection title={t("settings.general.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.language.label")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.general.language.description")}</Text>
          </View>
          <DropdownMenu>
            <DropdownTrigger accessibilityRole="button" accessibilityLabel={selectedLanguageLabel}>
              {selectedLanguageLabel}
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={300}>
              {LANGUAGE_OPTIONS.map((option) => (
                <LanguageMenuItem
                  key={option.value}
                  value={option.value}
                  activeLocale={activeLocale}
                  selected={settings.language === option.value}
                  onChange={handleLanguageChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        {isNative ? null : <ShowSetupAgainRow />}
      </View>
    </SettingsSection>
  );
}

function ShowSetupAgainRow() {
  const { t } = useTranslation();
  const openOnboarding = useOpenOnboarding();
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.general.setup.label")}</Text>
        <Text style={settingsStyles.rowHint}>{t("settings.general.setup.description")}</Text>
      </View>
      <Button variant="secondary" onPress={openOnboarding ?? undefined} disabled={!openOnboarding}>
        {t("settings.general.setup.action")}
      </Button>
    </View>
  );
}

interface DiagnosticsSectionProps {
  voiceAudioEngine: ReturnType<typeof useVoiceAudioEngineOptional>;
  isPlaybackTestRunning: boolean;
  playbackTestResult: string | null;
  handlePlaybackTest: () => Promise<void>;
}

function DiagnosticsSection({
  voiceAudioEngine,
  isPlaybackTestRunning,
  playbackTestResult,
  handlePlaybackTest,
}: DiagnosticsSectionProps) {
  const { t } = useTranslation();
  const openAppDiagnostic = useAppDiagnosticStore((state) => state.open);
  const handlePlayPress = useCallback(() => {
    void handlePlaybackTest();
  }, [handlePlaybackTest]);
  return (
    <SettingsSection title={t("settings.diagnostics.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row} testID="app-diagnostic-row">
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.app.rowTitle")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.diagnostics.app.rowHint")}</Text>
          </View>
          <Button variant="secondary" onPress={openAppDiagnostic}>
            {t("settings.diagnostics.app.run")}
          </Button>
        </View>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.testAudio")}</Text>
            {playbackTestResult ? (
              <Text style={settingsStyles.rowHint}>{playbackTestResult}</Text>
            ) : null}
          </View>
          <Button
            variant="secondary"
            onPress={handlePlayPress}
            disabled={!voiceAudioEngine || isPlaybackTestRunning}
          >
            {isPlaybackTestRunning
              ? t("settings.diagnostics.playing")
              : t("settings.diagnostics.playTest")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

interface AboutSectionProps {
  appVersion: string | null;
  appVersionText: string;
  isDesktopApp: boolean;
}

function AboutSection({ appVersion, appVersionText, isDesktopApp }: AboutSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection title={t("settings.about.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.about.appVersion")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.about.thisDevice")}</Text>
            </View>
            <Text style={styles.aboutValue}>{appVersionText}</Text>
          </View>
          {IS_PAVRA ? <PavraVersionStatusRow appVersion={appVersion} /> : null}
          <WhatsNewRow />
          {isDesktopApp ? <DesktopAppUpdateRow /> : null}
          {isAndroidApkUpdateSupported() ? <AndroidApkUpdateRow /> : null}
        </View>
      </SettingsSection>
      <ConnectedHostsSection clientVersion={appVersion} />
      <View style={styles.aboutCommunity}>
        <CommunityLinks />
      </View>
    </>
  );
}

function WhatsNewRow() {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  return (
    <Pressable
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      onPress={openChangelog}
      accessibilityRole="button"
      testID="settings-whats-new"
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
        <>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("changelog.title")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.about.whatsNewHint")}</Text>
          </View>
          <ChevronRight
            size={theme.iconSize.sm}
            color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
          />
        </>
      )}
    </Pressable>
  );
}

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/i, "");
}

function ConnectedHostsSection({ clientVersion }: { clientVersion: string | null }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  if (hosts.length === 0) {
    return null;
  }
  return (
    <SettingsSection title={t("settings.about.connectedHosts")}>
      <View style={settingsStyles.card}>
        {hosts.map((host, index) => (
          <HostVersionRow
            key={host.serverId}
            host={host}
            showBorder={index > 0}
            clientVersion={clientVersion}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function HostVersionRow({
  host,
  showBorder,
  clientVersion,
}: {
  host: HostProfile;
  showBorder: boolean;
  clientVersion: string | null;
}) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  const normalizedHost = normalizeVersion(daemonVersion);
  const normalizedClient = normalizeVersion(clientVersion);
  const isMismatch =
    normalizedHost !== null && normalizedClient !== null && normalizedHost !== normalizedClient;

  let valueText: string;
  if (!isConnected) {
    valueText = t("settings.about.offline");
  } else if (normalizedHost) {
    valueText = formatVersionWithPrefix(normalizedHost);
  } else {
    valueText = "—";
  }

  const valueStyle = useMemo(
    () => [styles.aboutValue, isMismatch && styles.aboutVersionMismatch],
    [isMismatch],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {host.label}
        </Text>
        {isMismatch ? (
          <Text style={settingsStyles.rowHint}>{t("settings.about.versionDiffers")}</Text>
        ) : null}
      </View>
      <Text style={valueStyle}>{valueText}</Text>
    </View>
  );
}

function getUpdateButtonLabel(
  t: TFunction,
  isInstalling: boolean,
  latestVersion: string | null | undefined,
): string {
  if (isInstalling) return t("settings.about.updates.installing");
  if (latestVersion) {
    return t("settings.about.updates.updateTo", {
      version: formatVersionWithPrefix(latestVersion),
    });
  }
  return t("settings.about.updates.update");
}

function DesktopAppUpdateRow() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const {
    isDesktopApp,
    statusText,
    availableUpdate,
    errorMessage,
    isChecking,
    isInstalling,
    checkForUpdates,
    installUpdate,
  } = useDesktopAppUpdater();

  useFocusEffect(
    useCallback(() => {
      if (!isDesktopApp) {
        return undefined;
      }
      void checkForUpdates({ intent: "automatic", silent: true });
      return undefined;
    }, [checkForUpdates, isDesktopApp]),
  );

  const handleCheckForUpdates = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }
    void checkForUpdates();
  }, [checkForUpdates, isDesktopApp]);

  const handleReleaseChannelChange = useCallback(
    (releaseChannel: EffectiveSettings["releaseChannel"]) => {
      void updateSettings({ releaseChannel });
    },
    [updateSettings],
  );
  const releaseChannelOptions = useMemo(
    () => [
      { value: "stable" as const, label: t("settings.about.releaseChannel.stable") },
      { value: "beta" as const, label: t("settings.about.releaseChannel.beta") },
    ],
    [t],
  );

  const handleInstallUpdate = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }

    void confirmDialog({
      title: t("settings.about.updates.installTitle"),
      message: t("settings.about.updates.installMessage"),
      confirmLabel: t("settings.about.updates.installConfirm"),
      cancelLabel: t("common.actions.cancel"),
    })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        void installUpdate();
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to open app update confirmation", error);
        Alert.alert(
          t("settings.about.updates.alertTitle"),
          t("settings.about.updates.alertMessage"),
        );
      });
  }, [installUpdate, isDesktopApp, t]);

  const isUpdateReady = availableUpdate?.readyToInstall === true;
  const readyUpdateVersion = isUpdateReady ? availableUpdate?.latestVersion : null;

  if (!isDesktopApp) {
    return null;
  }

  return (
    <>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.about.releaseChannel.label")}</Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.about.releaseChannel.description")}
          </Text>
        </View>
        <SegmentedControl
          value={settings.releaseChannel}
          onValueChange={handleReleaseChannelChange}
          options={releaseChannelOptions}
        />
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.about.updates.label")}</Text>
          <Text style={settingsStyles.rowHint}>{statusText}</Text>
          {readyUpdateVersion ? (
            <Text style={settingsStyles.rowHint}>
              {t("settings.about.updates.readyToInstall", {
                version: formatVersionWithPrefix(readyUpdateVersion),
              })}
            </Text>
          ) : null}
          {errorMessage ? <Text style={styles.aboutErrorText}>{errorMessage}</Text> : null}
        </View>
        <View style={styles.aboutUpdateActions}>
          <Button
            variant="outline"
            onPress={handleCheckForUpdates}
            disabled={isChecking || isInstalling}
          >
            {isChecking ? t("settings.about.updates.checking") : t("settings.about.updates.check")}
          </Button>
          <Button
            variant="default"
            onPress={handleInstallUpdate}
            disabled={isChecking || isInstalling || !isUpdateReady}
          >
            {getUpdateButtonLabel(t, isInstalling, readyUpdateVersion)}
          </Button>
        </View>
      </View>
    </>
  );
}

function usePavraCoordinatorVersion() {
  const hosts = useHosts();
  const savedCoordinatorId = usePavraView((state) => state.coordinatorId);
  const coordinatorId = resolveDefaultCoordinatorId(savedCoordinatorId, hosts);
  const { state, connected } = usePavraData(IS_PAVRA ? coordinatorId : "");
  const coordinatorHost = hosts.find((host) => host.serverId === coordinatorId) ?? null;
  const coordinatorVersion = normalizeVersion(
    (state as { coordinatorVersion?: string }).coordinatorVersion,
  );
  return {
    coordinatorHostLabel: coordinatorHost?.label ?? null,
    coordinatorVersion,
    connected,
  };
}

function formatPavraCoordinatorSummary(input: {
  clientVersion: string;
  coordinatorHostLabel: string | null;
  coordinatorVersion: string | null;
  connected: boolean;
}): { hintText: string; valueText: string; isMismatch: boolean } {
  const clientText = formatVersionWithPrefix(input.clientVersion);
  const hostPrefix = input.coordinatorHostLabel ? `${input.coordinatorHostLabel} · ` : "";
  if (!input.connected) {
    return {
      hintText: `Client ${clientText} · Coordinator ${hostPrefix}offline`,
      valueText: `${clientText} / offline`,
      isMismatch: false,
    };
  }
  if (!input.coordinatorVersion) {
    return {
      hintText: `Client ${clientText} · Coordinator ${hostPrefix}connected`,
      valueText: clientText,
      isMismatch: false,
    };
  }
  const coordinatorText = formatVersionWithPrefix(input.coordinatorVersion);
  const isMismatch = input.coordinatorVersion !== input.clientVersion;
  const alignmentSuffix = isMismatch ? " · Version mismatch" : " · Aligned";
  return {
    hintText: `Client ${clientText} · Coordinator ${hostPrefix}${coordinatorText}${alignmentSuffix}`,
    valueText: `${clientText} / ${coordinatorText}`,
    isMismatch,
  };
}

function PavraVersionStatusRow({ appVersion }: { appVersion: string | null }) {
  const clientVersion = normalizeVersion(appVersion ?? resolveAppVersion()) ?? "0.16.0";
  const { coordinatorHostLabel, coordinatorVersion, connected } = usePavraCoordinatorVersion();
  const { hintText, valueText, isMismatch } = formatPavraCoordinatorSummary({
    clientVersion,
    coordinatorHostLabel,
    coordinatorVersion,
    connected,
  });
  const rowStyle = useMemo(() => [settingsStyles.row, settingsStyles.rowBorder], []);
  const hintStyle = useMemo(
    () => [settingsStyles.rowHint, isMismatch && styles.aboutVersionMismatch],
    [isMismatch],
  );
  const valueStyle = useMemo(
    () => [styles.aboutValue, isMismatch && styles.aboutVersionMismatch],
    [isMismatch],
  );

  return (
    <View style={rowStyle} testID="settings-pavra-version-status">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>Pavra Coordinator & Client</Text>
        <Text style={hintStyle}>{hintText}</Text>
      </View>
      <Text style={valueStyle}>{valueText}</Text>
    </View>
  );
}

function formatAndroidApkUpdateHint(input: {
  statusMessage: string | null;
  hasUpdate: boolean;
  availableRelease: { version: string; revision: string | null } | null;
  installedLabel: string;
  coordinatorVersion: string | null;
}): string {
  const coordinatorSuffix = input.coordinatorVersion
    ? ` · Coordinator ${formatVersionWithPrefix(input.coordinatorVersion)}`
    : "";
  if (input.statusMessage) {
    return `${input.statusMessage}${coordinatorSuffix}`;
  }
  if (input.hasUpdate && input.availableRelease) {
    const releaseRevision = input.availableRelease.revision
      ? ` · ${input.availableRelease.revision}`
      : "";
    return `New APK available: v${input.availableRelease.version}${releaseRevision} (Client ${input.installedLabel}${coordinatorSuffix})`;
  }
  return `Client: ${input.installedLabel}${coordinatorSuffix}`;
}

function renderAndroidApkUpdateRightStatus(input: {
  checking: boolean;
  checkPhase: ApkUpdateCheckPhase;
  taskPhase: ApkUpdateTaskPhase;
  progress: number | null;
  availableRelease: { version: string } | null;
  isSkipped: boolean;
  spinnerColor: string;
}): ReactNode {
  if (input.checking || input.checkPhase === "checking") {
    return <ActivityIndicator size="small" color={input.spinnerColor} />;
  }
  if (
    input.taskPhase === "ready" ||
    input.taskPhase === "installing" ||
    input.taskPhase === "needsPermission"
  ) {
    return (
      <View style={styles.apkUpdateBadge}>
        <Text style={styles.apkUpdateBadgeText}>Ready to install</Text>
      </View>
    );
  }
  if (input.taskPhase === "downloading" || input.taskPhase === "verifying") {
    const pct =
      typeof input.progress === "number" && Number.isFinite(input.progress)
        ? Math.round(Math.max(0, Math.min(1, input.progress)) * 100)
        : 0;
    return <Text style={styles.aboutValue}>{`Downloading ${pct}%`}</Text>;
  }
  if (input.availableRelease && input.isSkipped) {
    return <Text style={styles.aboutValue}>{`Skipped v${input.availableRelease.version}`}</Text>;
  }
  if (input.availableRelease) {
    return (
      <View style={styles.apkUpdateBadge}>
        <Text style={styles.apkUpdateBadgeText}>{`● New v${input.availableRelease.version}`}</Text>
      </View>
    );
  }
  if (input.checkPhase === "unavailable") {
    return <Text style={styles.aboutValue}>Unavailable</Text>;
  }
  return <Text style={styles.aboutValue}>Up to date</Text>;
}

function AndroidApkUpdateRow() {
  const { theme } = useUnistyles();
  const {
    installed,
    availableRelease,
    hasUpdate,
    isSkipped,
    autoCheck,
    checkPhase,
    taskPhase,
    progress,
    checking,
    statusMessage,
    setAutoCheck,
    openUpdateSheet,
    checkForApkUpdate,
  } = usePavraApkUpdater();
  const { coordinatorVersion } = usePavraCoordinatorVersion();

  const handlePressCheckRow = useCallback(() => {
    const hasActiveTask =
      taskPhase === "downloading" ||
      taskPhase === "verifying" ||
      taskPhase === "ready" ||
      taskPhase === "needsPermission" ||
      taskPhase === "installing";
    if (availableRelease && (hasActiveTask || !isSkipped)) {
      openUpdateSheet();
      return;
    }
    void checkForApkUpdate({ manual: true });
  }, [availableRelease, checkForApkUpdate, isSkipped, openUpdateSheet, taskPhase]);

  const resolvedClientVersion = normalizeVersion(resolveAppVersion()) ?? installed.version;
  const revisionSuffix = installed.revision ? ` · ${installed.revision}` : "";
  const installedLabel = `v${resolvedClientVersion}${revisionSuffix}`;
  const hintText = formatAndroidApkUpdateHint({
    statusMessage,
    hasUpdate,
    availableRelease,
    installedLabel,
    coordinatorVersion,
  });
  const isCoordinatorMismatch =
    coordinatorVersion !== null && coordinatorVersion !== resolvedClientVersion;
  const rowStyle = useMemo(() => [settingsStyles.row, settingsStyles.rowBorder], []);
  const hintStyle = useMemo(
    () => [
      settingsStyles.rowHint,
      (hasUpdate || isCoordinatorMismatch) && styles.aboutVersionMismatch,
    ],
    [hasUpdate, isCoordinatorMismatch],
  );
  const rightStatus = renderAndroidApkUpdateRightStatus({
    checking,
    checkPhase,
    taskPhase,
    progress,
    availableRelease,
    isSkipped,
    spinnerColor: theme.colors.foregroundMuted,
  });

  return (
    <>
      <Pressable
        style={rowStyle}
        onPress={handlePressCheckRow}
        disabled={checking}
        accessibilityRole="button"
        testID="settings-android-apk-update"
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Check for updates</Text>
          <Text style={hintStyle}>{hintText}</Text>
        </View>
        <View style={styles.aboutUpdateActions}>{rightStatus}</View>
      </Pressable>
      <View style={rowStyle} testID="settings-android-apk-auto-check">
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Automatic update check</Text>
          <Text style={settingsStyles.rowHint}>
            Check for new Pavra APK releases once every 24 hours
          </Text>
        </View>
        <Switch
          value={autoCheck}
          onValueChange={setAutoCheck}
          accessibilityLabel="Automatic update check"
          testID="settings-android-apk-auto-check-switch"
        />
      </View>
      <ApkUpdateSheet />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

/**
 * Local daemon first, then remaining hosts in their existing order.
 */
function useSortedHosts(hosts: HostProfile[], localServerId: string | null): HostProfile[] {
  return useMemo(() => orderHostsLocalFirst(hosts, localServerId), [hosts, localServerId]);
}

interface SidebarSectionButtonProps {
  itemId: SettingsSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  isSelected: boolean;
  badgeText?: string;
  onSelect: (section: SettingsSectionSlug) => void;
}

// Lighter than lucide's default 2px stroke so the nav reads quieter than the content.
const SIDEBAR_ICON_STROKE_WIDTH = 1.5;

function getSidebarIconColor(
  isSelected: boolean,
  colors: { accent: string; foreground: string; foregroundMuted: string },
): string {
  if (!isSelected) {
    return colors.foregroundMuted;
  }
  return IS_PAVRA ? colors.accent : colors.foreground;
}

function SidebarSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  badgeText,
  onSelect,
}: SidebarSectionButtonProps) {
  const { theme, rt } = useUnistyles();
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () => [sidebarStyles.label, isSelected && sidebarStyles.labelSelected],
    [isSelected],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <IconComponent
        size={IS_PAVRA ? 16 : densityIconSize(rt, "md")}
        color={getSidebarIconColor(isSelected, theme.colors)}
        strokeWidth={SIDEBAR_ICON_STROKE_WIDTH}
      />
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
      {badgeText ? (
        <View style={sidebarStyles.updateBadge}>
          <Text style={sidebarStyles.updateBadgeText}>{badgeText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

interface SidebarHostSectionButtonProps {
  itemId: HostSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  isSelected: boolean;
  onSelect: (section: HostSectionSlug) => void;
}

function SidebarHostSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarHostSectionButtonProps) {
  const { theme, rt } = useUnistyles();
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () => [sidebarStyles.label, isSelected && sidebarStyles.labelSelected],
    [isSelected],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      testID={`settings-host-section-${itemId}`}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <IconComponent
        size={IS_PAVRA ? 16 : densityIconSize(rt, "md")}
        color={getSidebarIconColor(isSelected, theme.colors)}
        strokeWidth={SIDEBAR_ICON_STROKE_WIDTH}
      />
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface HostPickerProps {
  activeServerId: string | null;
  sortedHosts: HostProfile[];
  onSelectHost: (serverId: string) => void;
  onAddHost: () => void;
  enableBuiltInDaemonOption: EnableBuiltInDaemonOption;
}

/**
 * Scopes the host sections to a host. Reuses the canonical sidebar host
 * switcher pattern (left-sidebar.tsx): a quiet row-styled trigger opening a
 * <Combobox>. The local host is listed first, each row shows the connection it
 * is using right now; an "Add host" row is always reachable from the list —
 * even with a single host.
 */
function HostPicker({
  activeServerId,
  sortedHosts,
  onSelectHost,
  onAddHost,
  enableBuiltInDaemonOption,
}: HostPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<View | null>(null);
  const activeHost =
    sortedHosts.find((host) => host.serverId === activeServerId) ?? sortedHosts[0] ?? null;

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const hostOptionTestID = useCallback(
    (serverId: string) => `settings-host-picker-item-${serverId}`,
    [],
  );
  const triggerStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sidebarStyles.pickerTrigger,
      hovered && sidebarStyles.pickerTriggerHovered,
      pressed && sidebarStyles.itemPressed,
    ],
    [],
  );

  return (
    <SharedHostPicker
      hosts={sortedHosts}
      value={activeServerId ?? ""}
      onSelect={onSelectHost}
      open={isOpen}
      onOpenChange={setIsOpen}
      anchorRef={triggerRef}
      includeAddHost
      onAddHost={onAddHost}
      includeEnableBuiltInDaemon={enableBuiltInDaemonOption.visible}
      onEnableBuiltInDaemon={enableBuiltInDaemonOption.onPress}
      showActiveConnection
      searchable={false}
      title={t("settings.hostPicker.switchHost")}
      desktopMinWidth={240}
      addHostTestID="settings-add-host"
      hostOptionTestID={hostOptionTestID}
    >
      <ComboboxTrigger
        ref={triggerRef}
        block
        style={triggerStyle}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={t("settings.hostPicker.switchHost")}
        testID="settings-host-picker"
      >
        {activeHost ? (
          <View style={sidebarStyles.pickerTriggerDot}>
            <HostStatusDot serverId={activeHost.serverId} />
          </View>
        ) : null}
        <Text style={sidebarStyles.pickerTriggerLabel} numberOfLines={1}>
          {activeHost?.label ?? t("settings.groups.host")}
        </Text>
      </ComboboxTrigger>
    </SharedHostPicker>
  );
}

/** A labelled group of sidebar rows. On compact layouts the rows sit together in one island. */
function SidebarGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View style={sidebarStyles.group}>
      {label ? <Text style={sidebarStyles.groupLabel}>{label}</Text> : null}
      <View style={sidebarStyles.island}>{children}</View>
    </View>
  );
}

interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  onSelectHost: (serverId: string) => void;
  onAddHost: () => void;
  onBackToWorkspace: () => void;
  activeHostServerId: string | null;
  layout: "desktop" | "mobile";
}

function SettingsSidebar({
  view,
  onSelectSection,
  onSelectHostSection,
  onSelectHost,
  onAddHost,
  onBackToWorkspace,
  activeHostServerId,
  layout,
}: SettingsSidebarProps) {
  const { theme, rt } = useUnistyles();
  const { t } = useTranslation();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const hasHosts = sortedHosts.length > 0;
  const enableBuiltInDaemonOption = useEnableBuiltInDaemonOption();
  const isDesktopApp = isElectronRuntime();
  const hasApkUpdate = usePavraApkUpdaterStore(
    (state) =>
      Boolean(state.availableRelease) && state.availableRelease?.version !== state.skippedVersion,
  );
  const hardwareKeyboardPresent = useHardwareKeyboardPresent();
  const items = SIDEBAR_SECTION_ITEMS.filter((item) =>
    isSectionAvailable(item, isDesktopApp, hardwareKeyboardPresent),
  );
  const insets = useSafeAreaInsets();
  const isDesktop = layout === "desktop";
  const sidebarScroll = useSettingsSidebarScroll(isDesktop);
  const outerContainerStyle = useMemo(
    () => [isDesktop ? sidebarStyles.desktopContainer : sidebarStyles.mobileContainer],
    [isDesktop],
  );
  const innerContainerStyle = useMemo(
    () => [{ flex: 1 }, isDesktop ? { paddingTop: insets.top } : null],
    [insets.top, isDesktop],
  );
  const selectedSectionId = view.kind === "section" ? view.section : null;
  let selectedHostSection: HostSectionSlug | null = null;
  if (view.kind === "host") selectedHostSection = view.section;
  if (view.kind === "project") selectedHostSection = "projects";
  if (view.kind === "plugin") selectedHostSection = "plugins";

  const sidebarBody = (
    <>
      <SidebarGroup label={t("settings.groups.app")}>
        {items.map((item) => (
          <SidebarSectionButton
            key={item.id}
            itemId={item.id}
            label={t(item.labelKey)}
            icon={item.icon}
            isSelected={selectedSectionId === item.id}
            badgeText={item.id === "about" && hasApkUpdate ? "Update" : undefined}
            onSelect={onSelectSection}
          />
        ))}
      </SidebarGroup>
      {hasHosts ? (
        <SidebarGroup label={t("settings.groups.host")}>
          <HostPicker
            activeServerId={activeHostServerId}
            sortedHosts={sortedHosts}
            onSelectHost={onSelectHost}
            onAddHost={onAddHost}
            enableBuiltInDaemonOption={enableBuiltInDaemonOption}
          />
          {HOST_SECTION_ITEMS.map((item) => (
            <SidebarHostSectionButton
              key={item.id}
              itemId={item.id}
              label={t(item.labelKey)}
              icon={item.icon}
              isSelected={selectedHostSection === item.id}
              onSelect={onSelectHostSection}
            />
          ))}
        </SidebarGroup>
      ) : (
        <SidebarGroup>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.addHost")}
            onPress={onAddHost}
            testID="settings-add-host"
            style={sidebarItemStyle}
          >
            <Plus
              size={densityIconSize(rt, "md")}
              color={theme.colors.foregroundMuted}
              strokeWidth={SIDEBAR_ICON_STROKE_WIDTH}
            />
            <Text style={sidebarStyles.label} numberOfLines={1}>
              {t("settings.addHost")}
            </Text>
          </Pressable>
          {enableBuiltInDaemonOption.visible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("settings.enableBuiltInDaemon")}
              onPress={enableBuiltInDaemonOption.onPress}
              testID="settings-enable-built-in-daemon"
              style={sidebarItemStyle}
            >
              <Server
                size={densityIconSize(rt, "md")}
                color={theme.colors.foregroundMuted}
                strokeWidth={SIDEBAR_ICON_STROKE_WIDTH}
              />
              <Text style={sidebarStyles.label} numberOfLines={1}>
                {t("settings.enableBuiltInDaemon")}
              </Text>
            </Pressable>
          ) : null}
        </SidebarGroup>
      )}
    </>
  );

  return (
    <View
      accessibilityLabel={t("settings.title")}
      role="navigation"
      style={outerContainerStyle}
      testID="settings-sidebar"
    >
      {isDesktop ? (
        <View style={innerContainerStyle}>
          <View style={sidebarStyles.sidebarDragArea}>
            <TitlebarDragRegion />
            <WindowChromeSafeArea placement="below" />
            <SidebarHeaderRow
              icon={ArrowLeft}
              label={t("settings.backToWorkspace")}
              onPress={onBackToWorkspace}
              testID="settings-back-to-workspace"
            />
          </View>
          <ScrollView
            style={sidebarStyles.scrollBody}
            showsVerticalScrollIndicator={false}
            testID="settings-sidebar-scroll-body"
            {...sidebarScroll}
          >
            {sidebarBody}
          </ScrollView>
        </View>
      ) : (
        sidebarBody
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export interface SettingsScreenProps {
  view: SettingsView;
}

export default function SettingsScreen({ view }: SettingsScreenProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const voiceAudioEngine = useVoiceAudioEngineOptional();
  const { settings, isLoading: settingsLoading, updateSettings } = useAppSettings();
  const [isPlaybackTestRunning, setIsPlaybackTestRunning] = useState(false);
  const [playbackTestResult, setPlaybackTestResult] = useState<string | null>(null);
  const isDesktopApp = isElectronRuntime();
  const hardwareKeyboardPresent = useHardwareKeyboardPresent();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const isCompactLayout = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const insetBottomStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const selectedSettingsHostServerId = useSettingsHostSelection();

  // The host the four sections scope to: the host on the active view, otherwise
  // the picker choice, otherwise the connected local daemon, otherwise the first host.
  const activeHostServerId = useMemo(() => {
    if (view.kind === "host" || view.kind === "project" || view.kind === "plugin")
      return view.serverId;
    return resolveActiveHostServerId({
      selectedServerId: selectedSettingsHostServerId,
      localServerId,
      hosts,
      orderedHosts: sortedHosts,
    });
  }, [view, selectedSettingsHostServerId, localServerId, hosts, sortedHosts]);

  const handleLanguageChange = useCallback(
    (language: AppLanguage) => {
      void updateSettings({ language });
    },
    [updateSettings],
  );

  const handlePlaybackTest = useCallback(async () => {
    if (!voiceAudioEngine || isPlaybackTestRunning) {
      return;
    }

    setIsPlaybackTestRunning(true);
    setPlaybackTestResult(null);

    try {
      const bytes = Buffer.from(THINKING_TONE_NATIVE_PCM_BASE64, "base64");
      await voiceAudioEngine.initialize();
      voiceAudioEngine.stop();
      await voiceAudioEngine.play({
        type: "audio/pcm;rate=16000;bits=16",
        size: bytes.byteLength,
        async arrayBuffer() {
          return Uint8Array.from(bytes).buffer;
        },
      });
      setPlaybackTestResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Settings] Playback test failed", error);
      setPlaybackTestResult(t("settings.diagnostics.playbackFailed", { message }));
    } finally {
      setIsPlaybackTestRunning(false);
    }
  }, [isPlaybackTestRunning, t, voiceAudioEngine]);

  const handleHostAdded = useCallback(
    (serverId: string) => {
      selectSettingsHost(serverId);
      const target = buildSettingsHostSectionRoute(serverId, "host");
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  const handleAddHost = useAddHost({ onAdded: handleHostAdded });

  const handleSelectSection = useCallback(
    (section: SettingsSectionSlug) => {
      const target = buildSettingsSectionRoute(section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  // Picker: choose the host for host-section rows. If the user is already on a
  // host detail route, keep that detail section and swap only the host segment.
  const handleSelectHost = useCallback(
    (serverId: string) => {
      selectSettingsHost(serverId);
      if (view.kind === "project") {
        const target = buildSettingsHostSectionRoute(serverId, "projects");
        if (isCompactLayout) {
          router.push(target);
        } else {
          router.replace(target);
        }
        return;
      }
      if (view.kind !== "host") {
        return;
      }
      const target = buildSettingsHostSectionRoute(serverId, view.section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router, view],
  );

  const handleSelectHostSection = useCallback(
    (section: HostSectionSlug) => {
      if (!activeHostServerId) {
        handleAddHost();
        return;
      }
      const target = buildSettingsHostSectionRoute(activeHostServerId, section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [activeHostServerId, handleAddHost, isCompactLayout, router],
  );

  const handleHostRemoved = useCallback(() => {
    const fallback = buildSettingsSectionRoute("general");
    if (isCompactLayout) {
      router.replace("/settings");
    } else {
      router.replace(fallback);
    }
  }, [isCompactLayout, router]);

  const handleBackFromDetail = useCallback(() => {
    returnFromSettings(view);
  }, [view]);

  const handleBackToWorkspace = useCallback(() => {
    returnFromSettings({ kind: "root" });
  }, []);

  // The header names the plugin; its tabs name the open settings screen.
  const pluginDisplayName = usePluginDisplayName(view.kind === "plugin" ? view : null);
  const detailTitle = ((): string | undefined => {
    if (view.kind === "plugin") return pluginDisplayName;
    if (view.kind === "host") {
      const item = HOST_SECTION_ITEMS.find((s) => s.id === view.section);
      return item ? t(item.labelKey) : undefined;
    }
    if (view.kind === "section") {
      const item = SIDEBAR_SECTION_ITEMS.find((s) => s.id === view.section);
      return item ? t(item.labelKey) : undefined;
    }
    if (view.kind === "project") {
      return t("settings.projects");
    }
    return undefined;
  })();

  const content: ReactNode = (() => {
    if (view.kind === "plugin")
      return (
        <PluginSettingsContent
          serverId={view.serverId}
          pluginId={view.pluginId}
          screenId={view.screenId}
          onBackToPlugins={handleBackFromDetail}
          showBackToPlugins={!isCompactLayout}
        />
      );
    if (view.kind === "host") {
      return renderHostSettingsContent(view, handleHostRemoved);
    }
    if (view.kind === "project") {
      return (
        <ProjectSettingsScreen
          serverId={view.serverId}
          projectId={view.projectId}
          onBackToProjects={handleBackFromDetail}
          showBackToProjects={!isCompactLayout}
        />
      );
    }
    if (view.kind === "section") {
      const item = SIDEBAR_SECTION_ITEMS.find((candidate) => candidate.id === view.section);
      if (!item || !isSectionAvailable(item, isDesktopApp, hardwareKeyboardPresent)) return null;
      switch (view.section) {
        case "general":
          return (
            <>
              <GeneralSection settings={settings} handleLanguageChange={handleLanguageChange} />
              <SendingSection />
              {isDesktopApp ? <OpenLocationSection /> : null}
            </>
          );
        case "diagnostics":
          return (
            <DiagnosticsSection
              voiceAudioEngine={voiceAudioEngine}
              isPlaybackTestRunning={isPlaybackTestRunning}
              playbackTestResult={playbackTestResult}
              handlePlaybackTest={handlePlaybackTest}
            />
          );
        case "about":
          return (
            <AboutSection
              appVersion={appVersion}
              appVersionText={appVersionText}
              isDesktopApp={isDesktopApp}
            />
          );
        default:
          return item.Content ? <item.Content /> : null;
      }
    }
    return null;
  })();

  if (settingsLoading) {
    return (
      <PavraPage>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{t("settings.loading")}</Text>
        </View>
      </PavraPage>
    );
  }

  // Mobile root: full-screen sidebar-as-list.
  if (isCompactLayout && view.kind === "root") {
    return (
      <PavraPage>
        <View style={styles.container}>
          <BackHeader title={t("settings.title")} onBack={handleBackToWorkspace} />
          <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>
            <SettingsSidebar
              view={view}
              onSelectSection={handleSelectSection}
              onSelectHostSection={handleSelectHostSection}
              onSelectHost={handleSelectHost}
              onAddHost={handleAddHost}
              onBackToWorkspace={handleBackToWorkspace}
              activeHostServerId={activeHostServerId}
              layout="mobile"
            />
          </ScrollView>
        </View>
      </PavraPage>
    );
  }

  if (isCompactLayout) {
    return (
      <PavraPage>
        <View style={styles.container}>
          <PageLayout title={detailTitle} onBack={handleBackFromDetail}>
            {content}
          </PageLayout>
        </View>
      </PavraPage>
    );
  }

  // Desktop split view — mirrors AppContainer: sidebar owns the titlebar drag
  // region + traffic-light padding; detail pane renders whatever header the
  // selected section provides.
  return (
    <PavraPage>
      <View style={styles.container}>
        <View style={desktopStyles.row}>
          <WindowChromeRegion corners="top-left">
            <SettingsSidebar
              view={view}
              onSelectSection={handleSelectSection}
              onSelectHostSection={handleSelectHostSection}
              onSelectHost={handleSelectHost}
              onAddHost={handleAddHost}
              onBackToWorkspace={handleBackToWorkspace}
              activeHostServerId={activeHostServerId}
              layout="desktop"
            />
          </WindowChromeRegion>
          <WindowChromeRegion corners="top-right">
            <View style={desktopStyles.contentPane} testID="settings-detail-pane">
              <PageLayout
                title={detailTitle}
                titleTestID="settings-detail-header-title"
                testID="settings-detail-scroll-body"
              >
                {content}
              </PageLayout>
            </View>
          </WindowChromeRegion>
        </View>
      </View>
    </PavraPage>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollView: {
    flex: 1,
  },
  aboutValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  aboutVersionMismatch: {
    color: theme.colors.palette.amber[500],
  },
  aboutErrorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  aboutCommunity: {
    marginTop: theme.spacing[4],
  },
  aboutUpdateActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  apkUpdateBadge: {
    borderRadius: 999,
    backgroundColor: theme.colors.palette.amber[500],
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  apkUpdateBadgeText: {
    color: "#111114",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[8],
  },
  placeholderText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

const desktopStyles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: "row",
  },
  contentPane: {
    flex: 1,
    minWidth: SETTINGS_DESKTOP_DETAIL_MIN_WIDTH,
  },
});

const PAVRA_SIDEBAR_METRICS = {
  desktopWidth: IS_PAVRA ? 228 : SETTINGS_DESKTOP_SIDEBAR_WIDTH,
  groupPaddingVertical: IS_PAVRA ? 6 : 8,
  groupPaddingHorizontal: IS_PAVRA ? 8 : 8,
  groupGapXs: IS_PAVRA ? 4 : 4,
  groupLabelFontSize: IS_PAVRA ? 10 : 15,
  groupLabelLetterSpacing: IS_PAVRA ? 1.2 : 0,
  groupLabelTextTransform: (IS_PAVRA ? "uppercase" : "none") as "uppercase" | "none",
  groupLabelPadXs: IS_PAVRA ? 10 : 16,
  islandGapXs: IS_PAVRA ? 1 : 2,
  islandRadiusXs: IS_PAVRA ? 12 : 16,
  islandBorderWidthXs: IS_PAVRA ? 1 : 0,
  itemGapXs: IS_PAVRA ? 10 : 12,
  itemMinHeightXs: IS_PAVRA ? 42 : 52,
  itemMinHeightMd: IS_PAVRA ? 34 : density.tightRowHeight.md,
  itemPadVertical: IS_PAVRA ? 6 : 4,
  itemPadHorizontalXs: IS_PAVRA ? 12 : 16,
  itemPadHorizontalMd: IS_PAVRA ? 10 : 8,
  itemRadiusMd: IS_PAVRA ? 10 : 8,
  itemBorderWidthMd: IS_PAVRA ? 1 : 0,
  labelFontSizeXs: IS_PAVRA ? 13 : 18,
  labelFontSizeMd: IS_PAVRA ? 12.5 : 15,
} as const;

const sidebarStyles = StyleSheet.create((theme) => {
  const hoverFill = IS_PAVRA ? theme.colors.surface1 : theme.colors.surfaceSidebarHover;
  const mobileRowFill = IS_PAVRA ? theme.colors.surface2 : theme.colors.surface1;
  return {
    desktopContainer: {
      width: PAVRA_SIDEBAR_METRICS.desktopWidth,
      flexShrink: 1,
      borderRightWidth: 1,
      borderRightColor: IS_PAVRA ? theme.colors.borderAccent : theme.colors.border,
      backgroundColor: IS_PAVRA ? theme.colors.surface0 : theme.colors.surfaceSidebar,
    },
    scrollBody: {
      flex: 1,
    },
    sidebarDragArea: {
      position: "relative",
    },
    mobileContainer: {
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
    },
    // Compact values draw each group as an island of tiles; desktop keeps a plain list.
    group: {
      paddingVertical: PAVRA_SIDEBAR_METRICS.groupPaddingVertical,
      paddingHorizontal: PAVRA_SIDEBAR_METRICS.groupPaddingHorizontal,
      gap: { xs: PAVRA_SIDEBAR_METRICS.groupGapXs, md: theme.spacing[0.5] },
    },
    groupLabel: {
      fontSize: PAVRA_SIDEBAR_METRICS.groupLabelFontSize,
      fontWeight: IS_PAVRA ? theme.fontWeight.bold : theme.fontWeight.normal,
      letterSpacing: PAVRA_SIDEBAR_METRICS.groupLabelLetterSpacing,
      textTransform: PAVRA_SIDEBAR_METRICS.groupLabelTextTransform,
      color: IS_PAVRA ? theme.colors.foregroundMuted : theme.colors.foregroundExtraMuted,
      paddingHorizontal: { xs: PAVRA_SIDEBAR_METRICS.groupLabelPadXs, md: theme.spacing[2] },
      paddingVertical: theme.spacing[1],
    },
    island: {
      gap: { xs: PAVRA_SIDEBAR_METRICS.islandGapXs, md: theme.spacing[0.5] },
      borderRadius: { xs: PAVRA_SIDEBAR_METRICS.islandRadiusXs, md: 0 },
      borderWidth: { xs: PAVRA_SIDEBAR_METRICS.islandBorderWidthXs, md: 0 },
      borderColor: IS_PAVRA ? theme.colors.borderAccent : "transparent",
      backgroundColor: {
        xs: IS_PAVRA ? theme.colors.surface2 : "transparent",
        md: "transparent",
      },
      overflow: "hidden",
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: { xs: PAVRA_SIDEBAR_METRICS.itemGapXs, md: theme.spacing[2] },
      minHeight: {
        xs: PAVRA_SIDEBAR_METRICS.itemMinHeightXs,
        md: PAVRA_SIDEBAR_METRICS.itemMinHeightMd,
      },
      paddingVertical: PAVRA_SIDEBAR_METRICS.itemPadVertical,
      paddingHorizontal: {
        xs: PAVRA_SIDEBAR_METRICS.itemPadHorizontalXs,
        md: PAVRA_SIDEBAR_METRICS.itemPadHorizontalMd,
      },
      borderRadius: { xs: 0, md: PAVRA_SIDEBAR_METRICS.itemRadiusMd },
      borderWidth: { xs: 0, md: PAVRA_SIDEBAR_METRICS.itemBorderWidthMd },
      borderColor: "transparent",
      backgroundColor: {
        xs: mobileRowFill,
        md: "transparent",
      },
    },
    itemHovered: {
      backgroundColor: hoverFill,
    },
    itemSelected: {
      backgroundColor: IS_PAVRA ? theme.colors.surface2 : theme.colors.surfaceSidebarHover,
      borderColor: IS_PAVRA ? theme.colors.borderAccent : "transparent",
      ...(IS_PAVRA ? theme.chrome.controlShadow : null),
    },
    // The workspace rows' pressed fill.
    itemPressed: {
      backgroundColor: theme.colors.surface2,
    },
    label: {
      fontSize: {
        xs: PAVRA_SIDEBAR_METRICS.labelFontSizeXs,
        md: PAVRA_SIDEBAR_METRICS.labelFontSizeMd,
      },
      color: IS_PAVRA ? theme.colors.foreground : theme.colors.foregroundMuted,
      fontWeight: IS_PAVRA ? theme.fontWeight.medium : theme.fontWeight.normal,
      flex: 1,
    },
    labelSelected: {
      color: theme.colors.foreground,
      fontWeight: IS_PAVRA ? theme.fontWeight.semibold : theme.fontWeight.normal,
    },
    pickerTrigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: { xs: PAVRA_SIDEBAR_METRICS.itemGapXs, md: theme.spacing[2] },
      minHeight: {
        xs: PAVRA_SIDEBAR_METRICS.itemMinHeightXs,
        md: PAVRA_SIDEBAR_METRICS.itemMinHeightMd,
      },
      paddingVertical: PAVRA_SIDEBAR_METRICS.itemPadVertical,
      paddingHorizontal: {
        xs: PAVRA_SIDEBAR_METRICS.itemPadHorizontalXs,
        md: PAVRA_SIDEBAR_METRICS.itemPadHorizontalMd,
      },
      borderRadius: { xs: 0, md: PAVRA_SIDEBAR_METRICS.itemRadiusMd },
      backgroundColor: {
        xs: mobileRowFill,
        md: "transparent",
      },
    },
    pickerTriggerHovered: {
      backgroundColor: hoverFill,
    },
    pickerTriggerLabel: {
      flex: 1,
      minWidth: 0,
      fontSize: {
        xs: PAVRA_SIDEBAR_METRICS.labelFontSizeXs,
        md: PAVRA_SIDEBAR_METRICS.labelFontSizeMd,
      },
      color: theme.colors.foreground,
      fontWeight: IS_PAVRA ? theme.fontWeight.semibold : theme.fontWeight.normal,
    },
    // Match the setting items' icon footprint so the host label aligns with them.
    pickerTriggerDot: {
      width: densityIconBox("md"),
      height: densityIconBox("md"),
      alignItems: "center",
      justifyContent: "center",
    },
    updateBadge: {
      borderRadius: 999,
      backgroundColor: theme.colors.palette.amber[500],
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    updateBadgeText: {
      color: "#111114",
      fontSize: 11,
      fontWeight: theme.fontWeight.bold,
    },
  };
});
