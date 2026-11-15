import { isWeb } from "@/constants/platform";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { usePavraView } from "../store";
import { copyText } from "./clipboard";
import {
  isSafeFileRefPath,
  resolveWorkspaceRelativePath,
  type ParsedFileRef,
} from "./fileRefParser";
import { CheckIcon, CloseIcon, CopyIcon, ExternalLinkIcon, FileTextIcon } from "./icons";
import { MessageMarkdown } from "./MessageMarkdown";
import { ctrlShadow, text as type, webTransition, type Palette } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface FileRefReadResult {
  content: string;
  mimeType?: string;
  size?: number;
  truncated?: boolean;
  binary?: boolean;
}

export interface FileRefPreviewModalProps {
  fileRef: ParsedFileRef | null;
  machineId?: string;
  workspaceCwd?: string;
  onClose: () => void;
  onReadFile?: (machineId: string, path: string) => Promise<FileRefReadResult | string>;
  onOpenInStudio?: (ref: ParsedFileRef) => void;
}

type PreviewKind = "markdown" | "diff" | "code";

const DEFAULT_MAX_PREVIEW_BYTES = 256 * 1024;
const LINE_ROW_HEIGHT = 20;

function splitDirAndFilename(filePath: string): { cwd: string; targetPath: string } {
  const normalized = filePath.replace(/\\/g, "/").trim();
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return { cwd: ".", targetPath: normalized.replace(/^\/+/, "") || normalized };
  }
  return {
    cwd: normalized.slice(0, lastSlash) || "/",
    targetPath: normalized.slice(lastSlash + 1),
  };
}

/**
 * Reads a workspace file for preview using Paseo's connected host `DaemonClient.readFile` RPC,
 * enforcing path traversal guards before sending the request.
 */
export async function readWorkspaceFileForPreview(
  machineId: string,
  filePath: string,
  workspaceCwd?: string,
  maxBytes: number = DEFAULT_MAX_PREVIEW_BYTES,
): Promise<FileRefReadResult> {
  if (!isSafeFileRefPath(filePath, workspaceCwd)) {
    throw new Error(`Unsafe file path rejected: ${filePath}`);
  }

  const client = getHostRuntimeStore().getClient(machineId);
  if (!client) {
    throw new Error("Assistant host is not connected.");
  }

  let cwd: string;
  let targetPath: string;

  if (workspaceCwd && workspaceCwd.trim().length > 0) {
    const rel = resolveWorkspaceRelativePath(filePath, workspaceCwd);
    if (!rel) {
      throw new Error(`File path escapes workspace root: ${filePath}`);
    }
    cwd = workspaceCwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    targetPath = rel;
  } else {
    const split = splitDirAndFilename(filePath);
    cwd = split.cwd;
    targetPath = split.targetPath;
  }

  const response = await client.readFile(cwd, targetPath, undefined, maxBytes);
  if (response.kind === "binary" || response.kind === "image") {
    return {
      content: "",
      mimeType: response.mime,
      size: response.size,
      binary: true,
    };
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const content = decoder.decode(response.bytes);
  return {
    content,
    mimeType: response.mime,
    size: response.size,
    truncated: response.size > response.bytes.byteLength,
  };
}

/**
 * Opens a `ParsedFileRef` directly in Pavra Studio by preparing the Paseo workspace file tab
 * (including `lineStart` when `:line` was specified) and switching Pavra view mode to `"studio"`.
 */
export function openFileRefInStudio(input: {
  ref: ParsedFileRef;
  serverId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceCwd?: string;
  group?: string;
}): boolean {
  const relativePath =
    resolveWorkspaceRelativePath(input.ref.filePath, input.workspaceCwd) ?? input.ref.displayPath;
  if (!relativePath || !isSafeFileRefPath(relativePath)) {
    return false;
  }

  prepareWorkspaceTab(
    {
      serverId: input.serverId,
      workspaceId: input.workspaceId,
      target: {
        kind: "file",
        path: relativePath,
        ...(input.ref.line !== undefined ? { lineStart: input.ref.line } : {}),
      },
      pin: true,
    },
    { openTab: useWorkspaceLayoutStore.getState().deferOpenTab },
  );

  usePavraView.getState().openColumn({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    name: input.workspaceName,
    group: input.group ?? "General",
  });
  usePavraView.getState().setMode("studio");
  return true;
}

function detectPreviewKind(displayPath: string, content: string): PreviewKind {
  const lower = displayPath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) {
    return "markdown";
  }
  if (
    lower.endsWith(".diff") ||
    lower.endsWith(".patch") ||
    content.startsWith("diff --git ") ||
    content.startsWith("--- a/")
  ) {
    return "diff";
  }
  return "code";
}

function normalizeReadOutput(raw: FileRefReadResult | string): FileRefReadResult {
  if (typeof raw === "string") {
    return { content: raw, size: raw.length };
  }
  return raw;
}

function formatLineBadgeText(fileRef: ParsedFileRef): string | null {
  if (fileRef.line === undefined) {
    return null;
  }
  const colSuffix = fileRef.column !== undefined ? `:${fileRef.column}` : "";
  return `Line ${fileRef.line}${colSuffix}`;
}

function PreviewModalHeader({ fileRef, onClose }: { fileRef: ParsedFileRef; onClose: () => void }) {
  const { palette: t, name } = useTheme();
  const lineBadgeText = formatLineBadgeText(fileRef);

  return (
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
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <FileTextIcon color={t.onAccent} size={15} />
          <Text
            testID="file-ref-modal-title"
            numberOfLines={1}
            style={type(t.onAccent, 14, {
              fontFamily: "monospace",
              fontWeight: "700",
            })}
          >
            {fileRef.displayPath}
          </Text>
          {lineBadgeText ? (
            <Text
              testID="file-ref-modal-line-badge"
              style={type(t.brandAccent, 11, {
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
              {lineBadgeText}
            </Text>
          ) : null}
        </View>
        {fileRef.filePath !== fileRef.displayPath ? (
          <Text
            testID="file-ref-modal-filepath"
            numberOfLines={1}
            style={type(t.onAccent, 11, {
              fontFamily: "monospace",
            })}
          >
            {fileRef.filePath}
          </Text>
        ) : null}
      </View>

      <Pressable
        testID="file-ref-modal-close"
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
  );
}

function PreviewModalActionBar({
  fileRef,
  copiedKey,
  canCopyContent,
  showMarkdownToggle,
  mdMode,
  onCopyPath,
  onCopyContent,
  onToggleMdMode,
  onOpenInStudio,
  onClose,
}: {
  fileRef: ParsedFileRef;
  copiedKey: "path" | "content" | null;
  canCopyContent: boolean;
  showMarkdownToggle: boolean;
  mdMode: "rendered" | "source";
  onCopyPath: () => void;
  onCopyContent: () => void;
  onToggleMdMode: () => void;
  onOpenInStudio?: (ref: ParsedFileRef) => void;
  onClose: () => void;
}) {
  const { palette: t, name } = useTheme();
  const pathCopied = copiedKey === "path";
  const contentCopied = copiedKey === "content";

  return (
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pressable
          testID="file-ref-copy-path"
          role="button"
          accessibilityRole="button"
          accessibilityLabel="Copy Path"
          onPress={onCopyPath}
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
          {pathCopied ? (
            <CheckIcon color={t.success} size={12} />
          ) : (
            <CopyIcon color={t.textPrimary} size={12} />
          )}
          <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>
            {pathCopied ? "Copied Path" : "Copy Path"}
          </Text>
        </Pressable>

        <Pressable
          testID="file-ref-copy-content"
          role="button"
          accessibilityRole="button"
          accessibilityLabel="Copy Content"
          disabled={!canCopyContent}
          onPress={onCopyContent}
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
                opacity: canCopyContent ? 1 : 0.5,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          {contentCopied ? (
            <CheckIcon color={t.success} size={12} />
          ) : (
            <CopyIcon color={t.textPrimary} size={12} />
          )}
          <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>
            {contentCopied ? "Copied Content" : "Copy Content"}
          </Text>
        </Pressable>

        {showMarkdownToggle ? (
          <Pressable
            testID="file-ref-toggle-md-mode"
            role="button"
            accessibilityRole="button"
            accessibilityLabel={
              mdMode === "rendered" ? "Show Markdown Source" : "Show Rendered Markdown"
            }
            onPress={onToggleMdMode}
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
                  backgroundColor: hovered ? t.brandAccentSoft : t.surfacePrimary,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>
              {mdMode === "rendered" ? "View Source Lines" : "View Rendered"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {onOpenInStudio ? (
        <Pressable
          testID="file-ref-open-studio"
          role="button"
          accessibilityRole="button"
          accessibilityLabel="Open in Studio"
          onPress={() => {
            onOpenInStudio(fileRef);
            onClose();
          }}
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
                backgroundColor: hovered ? t.brandAccent : t.brandAccentSoft,
                paddingHorizontal: 12,
                paddingVertical: 6,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <ExternalLinkIcon color={t.onAccent} size={12} />
          <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Open in Studio</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function computeLineColors(
  lineText: string,
  previewKind: PreviewKind,
  isTargetLine: boolean,
  t: Palette,
): { rowBackground: string; lineColor: string } {
  if (isTargetLine) {
    return { rowBackground: t.brandAccentSoft, lineColor: t.onAccent };
  }
  if (previewKind === "diff") {
    if (lineText.startsWith("+") && !lineText.startsWith("+++")) {
      return { rowBackground: "rgba(45, 106, 79, 0.14)", lineColor: t.success };
    }
    if (lineText.startsWith("-") && !lineText.startsWith("---")) {
      return { rowBackground: "rgba(158, 42, 43, 0.14)", lineColor: t.destructive };
    }
    if (lineText.startsWith("@@")) {
      return { rowBackground: t.surfaceSecondary, lineColor: t.textMuted };
    }
  }
  return { rowBackground: "transparent", lineColor: t.textPrimary };
}

function PreviewCodeLineRow({
  lineNumber,
  lineText,
  isTargetLine,
  previewKind,
  theme: t,
}: {
  lineNumber: number;
  lineText: string;
  isTargetLine: boolean;
  previewKind: PreviewKind;
  theme: Palette;
}) {
  const { rowBackground, lineColor } = computeLineColors(lineText, previewKind, isTargetLine, t);
  return (
    <View
      testID={isTargetLine ? "file-ref-highlighted-line" : `file-ref-line-${lineNumber}`}
      {...({
        "data-line-number": String(lineNumber),
        "data-highlighted": isTargetLine ? "true" : undefined,
      } as object)}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        minHeight: LINE_ROW_HEIGHT,
        backgroundColor: rowBackground,
        borderLeftWidth: isTargetLine ? 3 : 0,
        borderLeftColor: isTargetLine ? t.brandAccent : "transparent",
        paddingRight: 12,
      }}
    >
      <Text
        selectable={false}
        style={{
          width: 48,
          paddingRight: 10,
          textAlign: "right",
          fontFamily: "monospace",
          fontSize: 11,
          lineHeight: LINE_ROW_HEIGHT,
          fontWeight: isTargetLine ? "700" : "400",
          color: isTargetLine ? t.onAccent : t.textMuted,
          fontVariant: ["tabular-nums"],
        }}
      >
        {lineNumber}
      </Text>
      <Text
        selectable
        style={{
          flex: 1,
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: LINE_ROW_HEIGHT,
          fontWeight: isTargetLine ? "600" : "400",
          color: lineColor,
          ...(isWeb ? ({ whiteSpace: "pre" } as TextStyle) : null),
        }}
      >
        {lineText || " "}
      </Text>
    </View>
  );
}

function PreviewModalBody({
  loading,
  error,
  result,
  previewKind,
  mdMode,
  content,
  lines,
  targetLine,
  workspaceCwd,
  scrollRef,
}: {
  loading: boolean;
  error: string | null;
  result: FileRefReadResult | null;
  previewKind: PreviewKind;
  mdMode: "rendered" | "source";
  content: string;
  lines: string[];
  targetLine?: number;
  workspaceCwd?: string;
  scrollRef: RefObject<ScrollView | null>;
}) {
  const { palette: t } = useTheme();

  if (loading) {
    return (
      <View
        testID="file-ref-loading"
        style={{ padding: 36, alignItems: "center", justifyContent: "center", gap: 10 }}
      >
        <ActivityIndicator color={t.textPrimary} />
        <Text style={type(t.textSecondary, 12, { fontFamily: "monospace" })}>
          Loading file preview…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View
        testID="file-ref-error"
        style={{
          margin: 16,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: t.destructive,
          backgroundColor: t.badgeRed,
          padding: 14,
          gap: 6,
        }}
      >
        <Text style={type(t.destructive, 12, { fontWeight: "700" })}>Unable to preview file</Text>
        <Text selectable style={type(t.textPrimary, 12, { fontFamily: "monospace" })}>
          {error}
        </Text>
      </View>
    );
  }

  if (result?.binary) {
    return (
      <View
        testID="file-ref-binary"
        style={{ padding: 32, alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <Text style={type(t.textSecondary, 13, { fontWeight: "600" })}>
          Binary or media file ({result.mimeType ?? "application/octet-stream"})
        </Text>
        <Text style={type(t.textMuted, 12)}>
          Use “Open in Studio” to inspect this file in the workspace tab.
        </Text>
      </View>
    );
  }

  if (previewKind === "markdown" && mdMode === "rendered") {
    return (
      <ScrollView
        ref={scrollRef}
        testID="file-ref-markdown-view"
        contentContainerStyle={{ padding: 16 }}
      >
        <MessageMarkdown
          content={content}
          color={t.textPrimary}
          narrow={false}
          workspaceCwd={workspaceCwd}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      testID={previewKind === "diff" ? "file-ref-diff-view" : "file-ref-code-view"}
      contentContainerStyle={{ paddingVertical: 8 }}
    >
      {lines.map((lineText, idx) => (
        <PreviewCodeLineRow
          key={idx + 1}
          lineNumber={idx + 1}
          lineText={lineText}
          isTargetLine={targetLine === idx + 1}
          previewKind={previewKind}
          theme={t}
        />
      ))}
    </ScrollView>
  );
}

export function FileRefPreviewModal({
  fileRef,
  machineId,
  workspaceCwd,
  onClose,
  onReadFile,
  onOpenInStudio,
}: FileRefPreviewModalProps) {
  const { palette: t, name } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FileRefReadResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<"path" | "content" | null>(null);
  const [mdMode, setMdMode] = useState<"rendered" | "source">("rendered");
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (!fileRef) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    setMdMode(fileRef.line !== undefined ? "source" : "rendered");

    if (
      !isSafeFileRefPath(fileRef.filePath, workspaceCwd) ||
      !isSafeFileRefPath(fileRef.displayPath)
    ) {
      setResult(null);
      setLoading(false);
      setError("Unsafe file path blocked outside workspace boundary.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);

    const runLoad = async () => {
      try {
        const output = onReadFile
          ? await onReadFile(machineId ?? "", fileRef.filePath)
          : await readWorkspaceFileForPreview(machineId ?? "", fileRef.filePath, workspaceCwd);
        if (!cancelled) {
          setResult(normalizeReadOutput(output));
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message || "Failed to read file.");
          setLoading(false);
        }
      }
    };

    void runLoad();

    return () => {
      cancelled = true;
    };
  }, [fileRef, machineId, workspaceCwd, onReadFile]);

  const content = result?.content ?? "";
  const previewKind = useMemo(
    () => (fileRef ? detectPreviewKind(fileRef.displayPath, content) : "code"),
    [fileRef, content],
  );
  const lines = useMemo(() => content.split(/\r?\n/), [content]);

  useEffect(() => {
    const targetLine = fileRef?.line;
    const shouldScroll =
      Boolean(targetLine && result && !loading) &&
      !(previewKind === "markdown" && mdMode === "rendered");
    if (!shouldScroll || !targetLine) {
      return;
    }
    const targetY = Math.max(0, (targetLine - 6) * LINE_ROW_HEIGHT);
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: targetY, animated: false });
    }, 30);
    return () => clearTimeout(timer);
  }, [fileRef?.line, result, loading, previewKind, mdMode]);

  if (!fileRef) {
    return null;
  }

  const triggerCopy = async (kind: "path" | "content", value: string) => {
    const status = await copyText(value);
    if (status === "copied") {
      setCopiedKey(kind);
      setTimeout(() => {
        setCopiedKey((current) => (current === kind ? null : current));
      }, 1400);
    }
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        testID="file-ref-preview-backdrop"
        accessibilityLabel="Close file preview"
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <Pressable
          testID="file-ref-preview-modal"
          onPress={() => {}}
          style={[
            {
              width: 760,
              maxWidth: "100%",
              maxHeight: "88%",
              borderRadius: 12,
              borderWidth: 2,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              overflow: "hidden",
            },
            ctrlShadow(t, name),
          ]}
        >
          <PreviewModalHeader fileRef={fileRef} onClose={onClose} />
          <PreviewModalActionBar
            fileRef={fileRef}
            copiedKey={copiedKey}
            canCopyContent={Boolean(result && !result.binary)}
            showMarkdownToggle={Boolean(previewKind === "markdown" && result && !result.binary)}
            mdMode={mdMode}
            onCopyPath={() => void triggerCopy("path", fileRef.displayPath)}
            onCopyContent={() => void triggerCopy("content", content)}
            onToggleMdMode={() =>
              setMdMode((current) => (current === "rendered" ? "source" : "rendered"))
            }
            onOpenInStudio={onOpenInStudio}
            onClose={onClose}
          />
          <View style={{ minHeight: 220, maxHeight: 520, backgroundColor: t.codeSurface }}>
            <PreviewModalBody
              loading={loading}
              error={error}
              result={result}
              previewKind={previewKind}
              mdMode={mdMode}
              content={content}
              lines={lines}
              targetLine={fileRef.line}
              workspaceCwd={workspaceCwd}
              scrollRef={scrollRef}
            />
          </View>
          {result?.truncated ? (
            <View
              testID="file-ref-truncated-banner"
              style={{
                borderTopWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.surfaceSecondary,
                paddingHorizontal: 14,
                paddingVertical: 6,
              }}
            >
              <Text style={type(t.textMuted, 11)}>
                Preview truncated for size — open in Studio to view the full file.
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
