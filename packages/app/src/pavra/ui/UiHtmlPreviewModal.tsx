import { isWeb } from "@/constants/platform";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { WebView } from "react-native-webview";
import { copyText } from "./clipboard";
import { HighlightedCode } from "./HighlightedCode";
import { CheckIcon, CloseIcon, CopyIcon, MonitorIcon, RefreshIcon } from "./icons";
import { ctrlShadow, selectedFillProps, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";
import { buildSandboxedHtmlDocument, detectHtmlPreviewKind } from "./uiHtmlPreview";

const ORIGIN_WHITELIST = ["*"];

export interface InlineHtmlPreviewFrameProps {
  code: string;
  lang?: string | null;
  height?: number;
  reloadKey?: number;
  testID?: string;
}

export function InlineHtmlPreviewFrame({
  code,
  lang,
  height = 220,
  reloadKey = 0,
  testID = "inline-html-preview-frame",
}: InlineHtmlPreviewFrameProps) {
  const { palette: t, name } = useTheme();
  const kind = useMemo(() => detectHtmlPreviewKind(lang, code), [lang, code]);
  const doc = useMemo(
    () => buildSandboxedHtmlDocument(code, { dark: name === "dark", kind }),
    [code, name, kind],
  );
  const nativeSource = useMemo(() => ({ html: doc, baseUrl: "about:blank" }), [doc]);

  return (
    <View
      testID={testID}
      {...({ "data-preview-kind": kind, "data-reload-key": String(reloadKey) } as object)}
      style={{
        height,
        width: "100%",
        overflow: "hidden",
        backgroundColor: t.surfacePrimary,
      }}
    >
      {isWeb ? (
        <iframe
          key={reloadKey}
          data-testid="ui-html-preview-iframe"
          title={kind === "svg" ? "Sandboxed SVG Preview" : "Sandboxed HTML Preview"}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={doc}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            display: "block",
            backgroundColor: name === "dark" ? "#141210" : "#fffef9",
          }}
        />
      ) : (
        <WebView
          key={reloadKey}
          testID="ui-html-preview-webview"
          source={nativeSource}
          originWhitelist={ORIGIN_WHITELIST}
          javaScriptEnabled
          domStorageEnabled={false}
          thirdPartyCookiesEnabled={false}
          cacheEnabled={false}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          style={{ flex: 1, backgroundColor: "transparent" }}
        />
      )}
    </View>
  );
}

export interface UiHtmlPreviewModalProps {
  visible?: boolean;
  open?: boolean;
  code: string | null;
  lang?: string | null;
  title?: string;
  onClose: () => void;
}

export function UiHtmlPreviewModal({
  visible,
  open,
  code,
  lang,
  title,
  onClose,
}: UiHtmlPreviewModalProps) {
  const { palette: t, name } = useTheme();
  const [activeTab, setActiveTab] = useState<"preview" | "source">("preview");
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setActiveTab("preview");
    setReloadKey(0);
    setCopied(false);
  }, [code]);

  const isVisible = (visible ?? open ?? true) && typeof code === "string" && code.trim().length > 0;
  if (!isVisible || !code) {
    return null;
  }

  const kind = detectHtmlPreviewKind(lang, code);
  const headerTitle = title ?? (kind === "svg" ? "SVG Preview" : "HTML UI Preview");
  const badgeLabel = (lang || kind).toUpperCase();

  const handleCopyHtml = async () => {
    const status = await copyText(code);
    if (status === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <Pressable
          testID="ui-html-preview-backdrop"
          accessibilityLabel="Close HTML preview"
          onPress={onClose}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          }}
        />
        <View
          testID="ui-html-preview-modal"
          style={[
            {
              width: 820,
              maxWidth: "100%",
              maxHeight: "90%",
              borderRadius: 12,
              borderWidth: 2,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              overflow: "hidden",
            },
            ctrlShadow(t, name),
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              borderBottomWidth: 2,
              borderColor: t.retroBorder,
              backgroundColor: t.brandAccent,
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}
            >
              <MonitorIcon color={t.onAccent} size={15} />
              <Text
                testID="ui-html-preview-modal-title"
                numberOfLines={1}
                style={type(t.onAccent, 14, {
                  fontWeight: "700",
                })}
              >
                {headerTitle}
              </Text>
              <Text
                style={type(t.brandAccent, 10, {
                  fontFamily: "monospace",
                  fontWeight: "700",
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.onAccent,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                })}
              >
                {badgeLabel}
              </Text>
            </View>

            <Pressable
              testID="ui-html-preview-close"
              role="button"
              accessibilityRole="button"
              accessibilityLabel="Close preview"
              onPress={onClose}
              style={(state) => {
                const hovered = Boolean((state as { hovered?: boolean }).hovered);
                return [
                  {
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: t.retroBorder,
                    backgroundColor: hovered ? t.surfaceSecondary : t.surfacePrimary,
                    alignItems: "center",
                    justifyContent: "center",
                    ...(isWeb ? (webTransition("background-color") as ViewStyle) : null),
                  },
                  ctrlShadow(t, name),
                ];
              }}
            >
              <CloseIcon color={t.textPrimary} size={14} />
            </Pressable>
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 8,
              borderBottomWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceSecondary,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
          >
            <View
              accessibilityRole="tablist"
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Pressable
                testID="ui-html-preview-tab-preview"
                role="tab"
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === "preview" }}
                onPress={() => setActiveTab("preview")}
                {...selectedFillProps(activeTab === "preview")}
                style={(state) => {
                  const hovered = Boolean((state as { hovered?: boolean }).hovered);
                  const selected = activeTab === "preview";
                  return [
                    {
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: t.retroBorder,
                      backgroundColor: selected
                        ? t.brandAccent
                        : hovered
                          ? t.surfaceTertiary
                          : t.surfacePrimary,
                      paddingHorizontal: 12,
                      paddingVertical: 5,
                    },
                    ctrlShadow(t, name),
                  ];
                }}
              >
                <Text
                  style={type(activeTab === "preview" ? t.onAccent : t.textPrimary, 11, {
                    fontWeight: "700",
                  })}
                >
                  Preview
                </Text>
              </Pressable>

              <Pressable
                testID="ui-html-preview-tab-source"
                role="tab"
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === "source" }}
                onPress={() => setActiveTab("source")}
                {...selectedFillProps(activeTab === "source")}
                style={(state) => {
                  const hovered = Boolean((state as { hovered?: boolean }).hovered);
                  const selected = activeTab === "source";
                  return [
                    {
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: t.retroBorder,
                      backgroundColor: selected
                        ? t.brandAccent
                        : hovered
                          ? t.surfaceTertiary
                          : t.surfacePrimary,
                      paddingHorizontal: 12,
                      paddingVertical: 5,
                    },
                    ctrlShadow(t, name),
                  ];
                }}
              >
                <Text
                  style={type(activeTab === "source" ? t.onAccent : t.textPrimary, 11, {
                    fontWeight: "700",
                  })}
                >
                  Source
                </Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable
                testID="ui-html-preview-reload"
                role="button"
                accessibilityRole="button"
                accessibilityLabel="Reload"
                onPress={() => setReloadKey((prev) => prev + 1)}
                style={(state) => {
                  const hovered = Boolean((state as { hovered?: boolean }).hovered);
                  return [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: t.retroBorder,
                      backgroundColor: hovered ? t.surfaceTertiary : t.surfacePrimary,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                    },
                    ctrlShadow(t, name),
                  ];
                }}
              >
                <RefreshIcon color={t.textPrimary} size={12} />
                <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Reload</Text>
              </Pressable>

              <Pressable
                testID="ui-html-preview-copy"
                role="button"
                accessibilityRole="button"
                accessibilityLabel="Copy HTML"
                onPress={() => void handleCopyHtml()}
                style={(state) => {
                  const hovered = Boolean((state as { hovered?: boolean }).hovered);
                  return [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: t.retroBorder,
                      backgroundColor: hovered ? t.surfaceTertiary : t.surfacePrimary,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                    },
                    ctrlShadow(t, name),
                  ];
                }}
              >
                {copied ? (
                  <CheckIcon color={t.success} size={12} />
                ) : (
                  <CopyIcon color={t.textPrimary} size={12} />
                )}
                <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>
                  {copied ? "Copied HTML" : "Copy HTML"}
                </Text>
              </Pressable>
            </View>
          </View>

          {activeTab === "preview" ? (
            <InlineHtmlPreviewFrame
              code={code}
              lang={lang}
              height={460}
              reloadKey={reloadKey}
              testID="ui-html-preview-modal-frame"
            />
          ) : (
            <View style={{ backgroundColor: t.codeSurface, maxHeight: 460 }}>
              <ScrollView
                testID="ui-html-preview-source"
                contentContainerStyle={{ padding: 14, minWidth: 0 }}
              >
                <HighlightedCode
                  code={code}
                  language={lang ?? "html"}
                  color={t.textPrimary}
                  narrow={false}
                  style={
                    isWeb
                      ? ({
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        } as TextStyle)
                      : undefined
                  }
                />
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
