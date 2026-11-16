import { isWeb } from "@/constants/platform";
// Migrated from Bigbang apps/app/src/MessageMarkdown.tsx. Keep presentation changes reviewable against that source.
import { useMemo, useState, type ReactNode } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { copyText } from "./clipboard";
import { parseFileRef, type ParsedFileRef } from "./fileRefParser";
import { HighlightedCode } from "./HighlightedCode";
import {
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  FileTextIcon,
  MaximizeIcon,
  MonitorIcon,
  RowsIcon,
} from "./icons";
import { InteractiveTableModal } from "./InteractiveTableModal";
import { linkKind, parseMarkdown, type MdBlock, type MdInline, type MdRoot } from "./markdown";
import { isPreviewableAgentPortUrl } from "./portPreviewUrl";
import { ctrlShadow, text as type, webTransition, type Palette } from "./theme";
import { useTheme } from "./ThemeProvider";
import {
  isInteractiveTableFenceLang,
  isPreviewableHtmlBlock,
  parseInteractiveTable,
} from "./uiHtmlPreview";
import { InlineHtmlPreviewFrame, UiHtmlPreviewModal } from "./UiHtmlPreviewModal";

export type { ParsedFileRef } from "./fileRefParser";

const COLLAPSE_LINES = 12;

export function MessageMarkdown({
  content,
  color,
  narrow,
  onOpenLocalPath,
  onOpenPortPreview,
  onPressPortUrl,
  onPressFileRef,
  onQuoteTableSelection,
  workspaceCwd,
}: {
  content: string;
  color: string;
  narrow: boolean;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
  onPressPortUrl?: (url: string) => void;
  onPressFileRef?: (ref: ParsedFileRef) => void;
  onQuoteTableSelection?: (markdown: string) => void;
  workspaceCwd?: string;
}) {
  const tree = useMemo(() => parseMarkdown(content), [content]);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const handlePortPreview = onPressPortUrl ?? onOpenPortPreview;
  return (
    <View testID="markdown-root" style={{ minWidth: 0, maxWidth: "100%" }}>
      <Blocks
        nodes={tree.children}
        color={color}
        narrow={narrow}
        onOpenLink={setPendingUrl}
        onOpenLocalPath={onOpenLocalPath}
        onOpenPortPreview={handlePortPreview}
        onPressFileRef={onPressFileRef}
        onQuoteTableSelection={onQuoteTableSelection}
        workspaceCwd={workspaceCwd}
      />
      <ExternalLinkModal url={pendingUrl} onClose={() => setPendingUrl(null)} />
    </View>
  );
}

const HEADING = {
  1: { fontSize: 30, lineHeight: 36 },
  2: { fontSize: 24, lineHeight: 32 },
  3: { fontSize: 20, lineHeight: 28 },
  4: { fontSize: 18, lineHeight: 28 },
  5: { fontSize: 16, lineHeight: 24 },
  6: { fontSize: 14, lineHeight: 20 },
} as const;

function Blocks({
  nodes,
  color,
  narrow,
  onOpenLink,
  onOpenLocalPath,
  onOpenPortPreview,
  onPressFileRef,
  onQuoteTableSelection,
  workspaceCwd,
  italic,
}: {
  nodes: MdRoot["children"];
  color: string;
  narrow: boolean;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
  onPressFileRef?: (ref: ParsedFileRef) => void;
  onQuoteTableSelection?: (markdown: string) => void;
  workspaceCwd?: string;
  italic?: boolean;
}) {
  return (
    <View style={{ gap: 8, minWidth: 0, maxWidth: "100%" }}>
      {nodes.map((node, index) => (
        <Block
          key={index}
          node={node}
          color={color}
          narrow={narrow}
          onOpenLink={onOpenLink}
          onOpenLocalPath={onOpenLocalPath}
          onOpenPortPreview={onOpenPortPreview}
          onPressFileRef={onPressFileRef}
          onQuoteTableSelection={onQuoteTableSelection}
          workspaceCwd={workspaceCwd}
          italic={italic}
        />
      ))}
    </View>
  );
}

function Block({
  node,
  color,
  narrow,
  onOpenLink,
  onOpenLocalPath,
  onOpenPortPreview,
  onPressFileRef,
  onQuoteTableSelection,
  workspaceCwd,
  italic,
}: {
  node: MdBlock;
  color: string;
  narrow: boolean;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
  onPressFileRef?: (ref: ParsedFileRef) => void;
  onQuoteTableSelection?: (markdown: string) => void;
  workspaceCwd?: string;
  italic?: boolean;
}) {
  const { palette: t } = useTheme();
  if (node.type === "paragraph") {
    return (
      <Text selectable style={bodyStyle(color, italic ? { fontStyle: "italic" } : undefined)}>
        <Inlines
          nodes={node.children}
          color={color}
          onOpenLink={onOpenLink}
          onOpenLocalPath={onOpenLocalPath}
          onOpenPortPreview={onOpenPortPreview}
          onPressFileRef={onPressFileRef}
          workspaceCwd={workspaceCwd}
        />
      </Text>
    );
  }
  if (node.type === "heading") {
    const size = HEADING[node.depth as keyof typeof HEADING] ?? HEADING[6];
    return (
      <Text selectable role="heading" style={bodyStyle(color, { ...size, fontWeight: "600" })}>
        <Inlines
          nodes={node.children}
          color={color}
          onOpenLink={onOpenLink}
          onOpenLocalPath={onOpenLocalPath}
          onOpenPortPreview={onOpenPortPreview}
          onPressFileRef={onPressFileRef}
          workspaceCwd={workspaceCwd}
        />
      </Text>
    );
  }
  if (node.type === "blockquote") {
    return (
      <View testID="markdown-blockquote" style={{ paddingLeft: 16, minWidth: 0, maxWidth: "100%" }}>
        <Blocks
          nodes={node.children}
          color={t.textMuted}
          narrow={narrow}
          onOpenLink={onOpenLink}
          onOpenLocalPath={onOpenLocalPath}
          onOpenPortPreview={onOpenPortPreview}
          onPressFileRef={onPressFileRef}
          onQuoteTableSelection={onQuoteTableSelection}
          workspaceCwd={workspaceCwd}
          italic
        />
      </View>
    );
  }
  if (node.type === "thematicBreak") {
    return <View style={{ height: 1, backgroundColor: t.dividerLine, marginVertical: 4 }} />;
  }
  if (node.type === "code") {
    return (
      <MarkdownCodeBlock
        lang={node.lang}
        value={node.value}
        narrow={narrow}
        onQuoteTableSelection={onQuoteTableSelection}
      />
    );
  }
  if (node.type === "list") {
    return (
      <View testID="markdown-list" style={{ minWidth: 0, maxWidth: "100%", gap: 4 }}>
        {node.children.map((item, index) => (
          <View
            key={index}
            testID={
              item.checked === null
                ? undefined
                : item.checked
                  ? "markdown-task-checked"
                  : "markdown-task-open"
            }
            style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, minWidth: 0 }}
          >
            <ListMarker
              ordered={node.ordered}
              index={node.start + index}
              checked={item.checked}
              theme={t}
              color={color}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Blocks
                nodes={item.children}
                color={color}
                narrow={narrow}
                onOpenLink={onOpenLink}
                onOpenLocalPath={onOpenLocalPath}
                onOpenPortPreview={onOpenPortPreview}
                onPressFileRef={onPressFileRef}
                onQuoteTableSelection={onQuoteTableSelection}
                workspaceCwd={workspaceCwd}
                italic={italic}
              />
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (node.type === "table") {
    return (
      <MarkdownTable
        node={node}
        color={color}
        onOpenLink={onOpenLink}
        onOpenLocalPath={onOpenLocalPath}
        onOpenPortPreview={onOpenPortPreview}
        onPressFileRef={onPressFileRef}
        onQuoteTableSelection={onQuoteTableSelection}
        workspaceCwd={workspaceCwd}
      />
    );
  }
  return null;
}

function ListMarker({
  ordered,
  index,
  checked,
  theme: t,
  color,
}: {
  ordered: boolean;
  index: number;
  checked: boolean | null;
  theme: Palette;
  color: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
      <Text
        style={type(color, 14, {
          lineHeight: 20,
          fontVariant: ordered ? ["tabular-nums"] : undefined,
        })}
      >
        {ordered ? `${index}.` : "•"}
      </Text>
      {checked !== null ? (
        <View
          accessibilityRole="checkbox"
          accessibilityState={{ checked, disabled: true }}
          style={{
            width: 14,
            height: 14,
            marginTop: 3,
            borderRadius: 2,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: checked ? t.brandAccent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {checked ? <CheckIcon color={t.onAccent} size={10} /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function FileRefChip({
  fileRef,
  onPress,
}: {
  fileRef: ParsedFileRef;
  onPress: (ref: ParsedFileRef) => void;
}) {
  const { palette: t, name } = useTheme();
  const lineBadge =
    fileRef.line !== undefined
      ? `:${fileRef.line}${fileRef.column !== undefined ? `:${fileRef.column}` : ""}`
      : null;

  return (
    <Pressable
      testID="file-ref-chip"
      role="button"
      accessibilityRole="button"
      accessibilityLabel={`Preview ${fileRef.displayPath}${lineBadge ?? ""}`}
      {...({
        "data-file-path": fileRef.filePath,
        "data-display-path": fileRef.displayPath,
        "data-file-line": fileRef.line !== undefined ? String(fileRef.line) : undefined,
      } as object)}
      onPress={() => onPress(fileRef)}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: hovered ? t.brandAccent : t.brandAccentSoft,
            paddingHorizontal: 6,
            paddingVertical: 1,
            marginHorizontal: 1,
            ...(isWeb
              ? ({
                  display: "inline-flex",
                  verticalAlign: "baseline",
                  cursor: "pointer",
                  ...webTransition("background-color, transform"),
                } as unknown as ViewStyle)
              : null),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <FileTextIcon color={t.onAccent} size={11} />
      <Text
        testID="file-ref-chip-path"
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          fontWeight: "700",
          color: t.onAccent,
        }}
      >
        {fileRef.displayPath}
      </Text>
      {lineBadge ? (
        <Text
          testID="file-ref-chip-line"
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            fontWeight: "700",
            color: t.brandAccent,
            backgroundColor: t.onAccent,
            borderRadius: 4,
            paddingHorizontal: 4,
            paddingVertical: 0.5,
          }}
        >
          {lineBadge}
        </Text>
      ) : null}
    </Pressable>
  );
}

function renderInlineCodeNode({
  index,
  value,
  theme: t,
  onPressFileRef,
  workspaceCwd,
}: {
  index: number;
  value: string;
  theme: Palette;
  onPressFileRef?: (ref: ParsedFileRef) => void;
  workspaceCwd?: string;
}) {
  const fileRef = onPressFileRef ? parseFileRef(value, workspaceCwd) : null;
  if (fileRef && onPressFileRef) {
    return <FileRefChip key={index} fileRef={fileRef} onPress={onPressFileRef} />;
  }
  return (
    <Text
      key={index}
      testID="markdown-inline-code"
      style={{
        fontFamily: "monospace",
        fontSize: 11,
        fontWeight: "500",
        color: t.codeForeground,
        backgroundColor: t.codeBackground,
        borderWidth: 1,
        borderColor: t.retroBorder,
        borderRadius: 10,
        paddingHorizontal: 4,
        paddingVertical: 1,
      }}
    >
      {value}
    </Text>
  );
}

function renderLocalLinkNode({
  index,
  node,
  theme: t,
  onOpenLink,
  onOpenLocalPath,
  onOpenPortPreview,
  onPressFileRef,
  workspaceCwd,
}: {
  index: number;
  node: Extract<MdInline, { type: "link" }>;
  theme: Palette;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
  onPressFileRef?: (ref: ParsedFileRef) => void;
  workspaceCwd?: string;
}) {
  const fileRef = onPressFileRef ? parseFileRef(node.url, workspaceCwd) : null;
  if (fileRef && onPressFileRef) {
    return <FileRefChip key={index} fileRef={fileRef} onPress={onPressFileRef} />;
  }
  return (
    <Text
      key={index}
      testID="markdown-path-chip"
      accessibilityRole={onOpenLocalPath ? "link" : undefined}
      accessibilityLabel={onOpenLocalPath ? `Open ${node.url}` : undefined}
      onPress={onOpenLocalPath ? () => onOpenLocalPath(node.url) : undefined}
      style={{
        fontFamily: "monospace",
        fontSize: 11,
        color: onOpenLocalPath ? t.link : t.textSecondary,
        borderWidth: 1,
        borderColor: t.retroBorderLight,
        borderRadius: 10,
        paddingHorizontal: 4,
        textDecorationLine: onOpenLocalPath ? "underline" : "none",
      }}
    >
      <Inlines
        nodes={node.children}
        color={onOpenLocalPath ? t.link : t.textSecondary}
        onOpenLink={onOpenLink}
        onOpenLocalPath={onOpenLocalPath}
        onOpenPortPreview={onOpenPortPreview}
        onPressFileRef={onPressFileRef}
        workspaceCwd={workspaceCwd}
      />
    </Text>
  );
}

function Inlines({
  nodes,
  color,
  onOpenLink,
  onOpenLocalPath,
  onOpenPortPreview,
  onPressFileRef,
  workspaceCwd,
}: {
  nodes: MdInline[];
  color: string;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
  onPressFileRef?: (ref: ParsedFileRef) => void;
  workspaceCwd?: string;
}): ReactNode {
  const { palette: t } = useTheme();
  return nodes.map((node, index) => {
    if (node.type === "text")
      return (
        <Text key={index} style={{ color }}>
          {node.value}
        </Text>
      );
    if (node.type === "break") return <Text key={index}>{"\n"}</Text>;
    if (node.type === "strong")
      return (
        <Text key={index} style={{ fontWeight: "700" }}>
          <Inlines
            nodes={node.children}
            color={color}
            onOpenLink={onOpenLink}
            onOpenLocalPath={onOpenLocalPath}
            onOpenPortPreview={onOpenPortPreview}
            onPressFileRef={onPressFileRef}
            workspaceCwd={workspaceCwd}
          />
        </Text>
      );
    if (node.type === "emphasis")
      return (
        <Text key={index} style={{ fontStyle: "italic" }}>
          <Inlines
            nodes={node.children}
            color={color}
            onOpenLink={onOpenLink}
            onOpenLocalPath={onOpenLocalPath}
            onOpenPortPreview={onOpenPortPreview}
            onPressFileRef={onPressFileRef}
            workspaceCwd={workspaceCwd}
          />
        </Text>
      );
    if (node.type === "delete")
      return (
        <Text key={index} style={{ textDecorationLine: "line-through" }}>
          <Inlines
            nodes={node.children}
            color={color}
            onOpenLink={onOpenLink}
            onOpenLocalPath={onOpenLocalPath}
            onOpenPortPreview={onOpenPortPreview}
            onPressFileRef={onPressFileRef}
            workspaceCwd={workspaceCwd}
          />
        </Text>
      );
    if (node.type === "code") {
      return renderInlineCodeNode({
        index,
        value: node.value,
        theme: t,
        onPressFileRef,
        workspaceCwd,
      });
    }
    if (node.type === "image") {
      return (
        <Text
          key={index}
          testID="markdown-inline-code"
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            borderRadius: 10,
            paddingHorizontal: 4,
            color: t.textSecondary,
          }}
        >
          {node.alt || node.url}
        </Text>
      );
    }
    const kind = linkKind(node.url);
    if (kind === "local") {
      return renderLocalLinkNode({
        index,
        node,
        theme: t,
        onOpenLink,
        onOpenLocalPath,
        onOpenPortPreview,
        onPressFileRef,
        workspaceCwd,
      });
    }
    if (kind === "unsafe") {
      return (
        <Text key={index} testID="markdown-unsafe-link">
          <Inlines
            nodes={node.children}
            color={color}
            onOpenLink={onOpenLink}
            onOpenLocalPath={onOpenLocalPath}
            onOpenPortPreview={onOpenPortPreview}
            onPressFileRef={onPressFileRef}
            workspaceCwd={workspaceCwd}
          />
        </Text>
      );
    }
    if (onOpenPortPreview && isPreviewableAgentPortUrl(node.url)) {
      return (
        <Text
          key={index}
          testID="port-preview-link"
          accessibilityRole="link"
          accessibilityLabel="Open through this Agent Node in Pavra"
          onPress={() => onOpenPortPreview(node.url)}
          style={{ color: t.link, textDecorationLine: "underline" }}
        >
          <Inlines
            nodes={node.children}
            color={t.link}
            onOpenLink={onOpenLink}
            onOpenLocalPath={onOpenLocalPath}
            onOpenPortPreview={onOpenPortPreview}
            onPressFileRef={onPressFileRef}
            workspaceCwd={workspaceCwd}
          />
        </Text>
      );
    }
    return (
      <Text
        key={index}
        accessibilityRole="link"
        onPress={() => onOpenLink(node.url)}
        style={{ color: t.link, textDecorationLine: "underline" }}
      >
        <Inlines
          nodes={node.children}
          color={t.link}
          onOpenLink={onOpenLink}
          onOpenLocalPath={onOpenLocalPath}
          onOpenPortPreview={onOpenPortPreview}
          onPressFileRef={onPressFileRef}
          workspaceCwd={workspaceCwd}
        />
      </Text>
    );
  });
}

function CodeBlockHeaderActions({
  isHtmlPreviewable,
  showInlinePreview,
  hasInteractiveJsonTable,
  copied,
  value,
  onToggleInlinePreview,
  onExpandHtmlModal,
  onOpenTableModal,
  onCopiedChange,
}: {
  isHtmlPreviewable: boolean;
  showInlinePreview: boolean;
  hasInteractiveJsonTable: boolean;
  copied: boolean;
  value: string;
  onToggleInlinePreview: () => void;
  onExpandHtmlModal: () => void;
  onOpenTableModal: () => void;
  onCopiedChange: (copied: boolean) => void;
}) {
  const { palette: t, name } = useTheme();
  const label = copied ? "Copied" : "Copy";

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {isHtmlPreviewable ? (
        <>
          <Pressable
            testID="markdown-html-preview-toggle"
            role="button"
            accessibilityRole="button"
            accessibilityLabel={showInlinePreview ? "Code" : "Preview UI"}
            onPress={onToggleInlinePreview}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              return [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: showInlinePreview
                    ? t.brandAccent
                    : hovered
                      ? t.brandAccentSoft
                      : t.surfaceSecondary,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <MonitorIcon color={showInlinePreview ? t.onAccent : t.textPrimary} size={11} />
            <Text
              style={type(showInlinePreview ? t.onAccent : t.textPrimary, 11, {
                fontWeight: "700",
              })}
            >
              {showInlinePreview ? "Code" : "Preview UI"}
            </Text>
          </Pressable>

          <Pressable
            testID="markdown-html-preview-expand"
            role="button"
            accessibilityRole="button"
            accessibilityLabel="Expand"
            onPress={onExpandHtmlModal}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              return [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: hovered ? t.surfaceTertiary : t.surfaceSecondary,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <MaximizeIcon color={t.textPrimary} size={11} />
            <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Expand</Text>
          </Pressable>
        </>
      ) : null}

      {hasInteractiveJsonTable ? (
        <Pressable
          testID="markdown-table-interactive-btn"
          role="button"
          accessibilityRole="button"
          accessibilityLabel="Interactive Table"
          onPress={onOpenTableModal}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              {
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: hovered ? t.brandAccent : t.brandAccentSoft,
                paddingHorizontal: 8,
                paddingVertical: 3,
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <RowsIcon color={t.onAccent} size={11} />
          <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Interactive Table</Text>
        </Pressable>
      ) : null}

      <Pressable
        role="button"
        accessibilityLabel={label}
        onPress={async () => {
          const result = await copyText(value);
          onCopiedChange(result === "copied");
          setTimeout(() => onCopiedChange(false), 1200);
        }}
        style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
      >
        {copied ? <CheckIcon color={t.success} /> : <CopyIcon color={t.textSecondary} />}
      </Pressable>
    </View>
  );
}

export function MarkdownCodeBlock({
  lang,
  value,
  narrow,
  onQuoteTableSelection,
}: {
  lang: string | null;
  value: string;
  narrow: boolean;
  onQuoteTableSelection?: (markdown: string) => void;
}) {
  const { palette: t, name } = useTheme();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showInlinePreview, setShowInlinePreview] = useState(false);
  const [expandHtmlModal, setExpandHtmlModal] = useState(false);
  const [openTableModal, setOpenTableModal] = useState(false);

  const isHtmlPreviewable = useMemo(() => isPreviewableHtmlBlock(lang, value), [lang, value]);
  const interactiveJsonTable = useMemo(
    () => (isInteractiveTableFenceLang(lang) ? parseInteractiveTable({ lang, code: value }) : null),
    [lang, value],
  );
  const hasInteractiveJsonTable = Boolean(
    interactiveJsonTable && interactiveJsonTable.rows.length >= 1,
  );

  const tall = value.split("\n").length > COLLAPSE_LINES;
  return (
    <View
      testID="markdown-code-block"
      {...({ "data-code-block-root": "true", "data-color-mode": name } as object)}
      style={{
        minWidth: 0,
        maxWidth: "100%",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: t.retroBorderLight,
        backgroundColor: t.codeSurface,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          borderBottomWidth: 1,
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfacePrimary,
          paddingHorizontal: 12,
          paddingVertical: 6,
        }}
      >
        <Text
          style={type(t.textMuted, 11, {
            fontWeight: "600",
            letterSpacing: 0.6,
            textTransform: "uppercase",
          })}
        >
          {lang || "text"}
        </Text>
        <CodeBlockHeaderActions
          isHtmlPreviewable={isHtmlPreviewable}
          showInlinePreview={showInlinePreview}
          hasInteractiveJsonTable={hasInteractiveJsonTable}
          copied={copied}
          value={value}
          onToggleInlinePreview={() => setShowInlinePreview((prev) => !prev)}
          onExpandHtmlModal={() => setExpandHtmlModal(true)}
          onOpenTableModal={() => setOpenTableModal(true)}
          onCopiedChange={setCopied}
        />
      </View>

      {isHtmlPreviewable && showInlinePreview ? (
        <InlineHtmlPreviewFrame code={value} lang={lang} height={220} />
      ) : (
        <>
          <ScrollView
            horizontal={!narrow}
            scrollEnabled={!narrow}
            style={{ maxHeight: tall && !expanded ? 200 : undefined }}
            contentContainerStyle={{ padding: 12, minWidth: 0 }}
          >
            <HighlightedCode
              code={value}
              language={lang}
              color={t.textPrimary}
              narrow={narrow}
              style={
                isWeb
                  ? ({
                      whiteSpace: narrow ? "pre-wrap" : "pre",
                      overflowWrap: "anywhere",
                    } as TextStyle)
                  : undefined
              }
            />
          </ScrollView>
          {tall ? (
            <Pressable
              role="button"
              accessibilityLabel={expanded ? "Show less" : "Show more"}
              onPress={() => setExpanded((open) => !open)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                borderTopWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.surfacePrimary,
                paddingVertical: 4,
              }}
            >
              <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
                <ChevronIcon color={t.textSecondary} size={10} down />
              </View>
              <Text style={type(t.textSecondary, 12)}>{expanded ? "Show less" : "Show more"}</Text>
            </Pressable>
          ) : null}
        </>
      )}

      {isHtmlPreviewable ? (
        <UiHtmlPreviewModal
          visible={expandHtmlModal}
          code={expandHtmlModal ? value : null}
          lang={lang}
          onClose={() => setExpandHtmlModal(false)}
        />
      ) : null}

      {hasInteractiveJsonTable && interactiveJsonTable ? (
        <InteractiveTableModal
          visible={openTableModal}
          table={openTableModal ? interactiveJsonTable : null}
          onClose={() => setOpenTableModal(false)}
          onQuoteSelection={onQuoteTableSelection}
        />
      ) : null}
    </View>
  );
}

function MarkdownTable({
  node,
  color,
  onOpenLink,
  onOpenLocalPath,
  onOpenPortPreview,
  onPressFileRef,
  onQuoteTableSelection,
  workspaceCwd,
}: {
  node: Extract<MdBlock, { type: "table" }>;
  color: string;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
  onPressFileRef?: (ref: ParsedFileRef) => void;
  onQuoteTableSelection?: (markdown: string) => void;
  workspaceCwd?: string;
}) {
  const { palette: t, name } = useTheme();
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const [openTableModal, setOpenTableModal] = useState(false);
  const interactiveTable = useMemo(() => parseInteractiveTable(node), [node]);
  const hasDataRows = interactiveTable.rows.length >= 1;
  const web = isWeb;
  return (
    <View style={{ gap: 6, minWidth: 0, maxWidth: "100%" }}>
      {hasDataRows ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            testID="markdown-table-interactive-btn"
            role="button"
            accessibilityRole="button"
            accessibilityLabel="Interactive Table"
            onPress={() => setOpenTableModal(true)}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              return [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: hovered ? t.brandAccent : t.brandAccentSoft,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <RowsIcon color={t.onAccent} size={12} />
            <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Interactive Table</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        testID="markdown-table"
        horizontal
        style={{
          minWidth: 0,
          maxWidth: "100%",
          borderWidth: 1,
          borderColor: t.retroBorder,
          borderRadius: 8,
        }}
        contentContainerStyle={{ minWidth: "100%" }}
      >
        <View
          style={
            web
              ? ({
                  display: "table",
                  width: "max-content",
                  minWidth: "100%",
                  borderCollapse: "collapse",
                  tableLayout: "auto",
                } as unknown as ViewStyle)
              : undefined
          }
        >
          {node.rows.map((row, rowIndex) => (
            <View
              key={rowIndex}
              testID="markdown-table-row"
              style={
                web ? ({ display: "table-row" } as unknown as ViewStyle) : { flexDirection: "row" }
              }
            >
              {row.cells.map((cell, cellIndex) => {
                const align = node.align[cellIndex] ?? "left";
                return (
                  <View
                    key={cellIndex}
                    testID="markdown-table-cell"
                    onLayout={
                      web
                        ? undefined
                        : ({ nativeEvent: { layout } }) =>
                            setColumnWidths((widths) => {
                              if (layout.width <= (widths[cellIndex] ?? 0)) return widths;
                              const next = [...widths];
                              next[cellIndex] = layout.width;
                              return next;
                            })
                    }
                    style={{
                      borderWidth: 1,
                      borderColor: name === "dark" ? t.retroBorderLight : t.retroBorder,
                      paddingHorizontal: 12,
                      paddingVertical: name === "dark" ? 8 : 6,
                      minWidth: web ? undefined : columnWidths[cellIndex],
                      backgroundColor: row.header
                        ? t.tableHeader
                        : name === "dark" && rowIndex % 2 === 1
                          ? t.surfaceSecondary
                          : t.surfacePrimary,
                      alignItems:
                        align === "center"
                          ? "center"
                          : align === "right"
                            ? "flex-end"
                            : "flex-start",
                      ...(web
                        ? ({
                            display: "table-cell",
                            verticalAlign: row.header ? "middle" : "top",
                            textAlign: align,
                          } as unknown as ViewStyle)
                        : null),
                    }}
                  >
                    <Text
                      selectable
                      numberOfLines={web ? undefined : 1}
                      style={bodyStyle(color, {
                        fontWeight: row.header ? (name === "dark" ? "600" : "700") : "400",
                        textAlign: align,
                        ...(web
                          ? ({
                              whiteSpace: "nowrap",
                              wordBreak: "normal",
                              overflowWrap: "normal",
                            } as TextStyle)
                          : null),
                      })}
                    >
                      <Inlines
                        nodes={cell}
                        color={color}
                        onOpenLink={onOpenLink}
                        onOpenLocalPath={onOpenLocalPath}
                        onOpenPortPreview={onOpenPortPreview}
                        onPressFileRef={onPressFileRef}
                        workspaceCwd={workspaceCwd}
                      />
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      {hasDataRows ? (
        <InteractiveTableModal
          visible={openTableModal}
          table={openTableModal ? interactiveTable : null}
          onClose={() => setOpenTableModal(false)}
          onQuoteSelection={onQuoteTableSelection}
        />
      ) : null}
    </View>
  );
}

function ExternalLinkModal({ url, onClose }: { url: string | null; onClose: () => void }) {
  const { palette: t, name } = useTheme();
  if (!url) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Dismiss link warning"
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Pressable
          onPress={() => {}}
          style={[
            {
              width: 360,
              maxWidth: "100%",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              overflow: "hidden",
            },
            ctrlShadow(t, name),
          ]}
        >
          <View
            style={{
              borderBottomWidth: 2,
              borderColor: t.retroBorder,
              backgroundColor: t.brandAccent,
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Text
              style={type(t.textPrimary, 14, {
                fontWeight: "700",
                letterSpacing: 1.2,
                textTransform: "uppercase",
              })}
            >
              Open external link?
            </Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}>
            <Text
              style={type(t.textSecondary, 12, { letterSpacing: 0.6, textTransform: "uppercase" })}
            >
              You’re about to visit an external website.
            </Text>
            <View
              style={[
                {
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.surfacePrimary,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                },
                ctrlShadow(t, name),
              ]}
            >
              <Text selectable style={type(t.textPrimary, 12, { fontFamily: "monospace" })}>
                {url}
              </Text>
            </View>
          </View>
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              borderTopWidth: 2,
              borderColor: t.retroBorder,
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <Pressable
              role="button"
              accessibilityLabel="Cancel"
              onPress={onClose}
              style={[
                {
                  flex: 1,
                  minHeight: 32,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.surfacePrimary,
                  alignItems: "center",
                  justifyContent: "center",
                },
                ctrlShadow(t, name),
              ]}
            >
              <Text style={type(t.textSecondary, 12, { fontWeight: "600" })}>Cancel</Text>
            </Pressable>
            <Pressable
              role="button"
              accessibilityLabel="Open link"
              onPress={() => {
                void Linking.openURL(url);
                onClose();
              }}
              style={[
                {
                  flex: 1,
                  minHeight: 32,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.brandAccent,
                  alignItems: "center",
                  justifyContent: "center",
                },
                ctrlShadow(t, name),
              ]}
            >
              <Text style={type(t.textPrimary, 12, { fontWeight: "600" })}>Open link</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function bodyStyle(color: string, extra?: TextStyle): TextStyle {
  return {
    ...type(color, 14, { lineHeight: 20 }),
    ...(isWeb ? ({ overflowWrap: "anywhere", wordBreak: "break-word" } as TextStyle) : null),
    ...extra,
  };
}
