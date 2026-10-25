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
import { HighlightedCode } from "./HighlightedCode";
import { CheckIcon, ChevronIcon, CopyIcon } from "./icons";
import { linkKind, parseMarkdown, type MdBlock, type MdInline, type MdRoot } from "./markdown";
import { isPreviewableAgentPortUrl } from "./portPreviewUrl";
import { ctrlShadow, text as type, type Palette } from "./theme";
import { useTheme } from "./ThemeProvider";

const COLLAPSE_LINES = 12;

export function MessageMarkdown({
  content,
  color,
  narrow,
  onOpenLocalPath,
  onOpenPortPreview,
}: {
  content: string;
  color: string;
  narrow: boolean;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
}) {
  const tree = useMemo(() => parseMarkdown(content), [content]);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  return (
    <View testID="markdown-root" style={{ minWidth: 0, maxWidth: "100%" }}>
      <Blocks
        nodes={tree.children}
        color={color}
        narrow={narrow}
        onOpenLink={setPendingUrl}
        onOpenLocalPath={onOpenLocalPath}
        onOpenPortPreview={onOpenPortPreview}
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
  italic,
}: {
  nodes: MdRoot["children"];
  color: string;
  narrow: boolean;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
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
  italic,
}: {
  node: MdBlock;
  color: string;
  narrow: boolean;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
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
          italic
        />
      </View>
    );
  }
  if (node.type === "thematicBreak") {
    return <View style={{ height: 1, backgroundColor: t.dividerLine, marginVertical: 4 }} />;
  }
  if (node.type === "code") {
    return <MarkdownCodeBlock lang={node.lang} value={node.value} narrow={narrow} />;
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

function Inlines({
  nodes,
  color,
  onOpenLink,
  onOpenLocalPath,
  onOpenPortPreview,
}: {
  nodes: MdInline[];
  color: string;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
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
          />
        </Text>
      );
    if (node.type === "code") {
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
          {node.value}
        </Text>
      );
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
          />
        </Text>
      );
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
          accessibilityLabel="Open through this Agent Node in Bigbang"
          onPress={() => onOpenPortPreview(node.url)}
          style={{ color: t.link, textDecorationLine: "underline" }}
        >
          <Inlines
            nodes={node.children}
            color={t.link}
            onOpenLink={onOpenLink}
            onOpenLocalPath={onOpenLocalPath}
            onOpenPortPreview={onOpenPortPreview}
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
        />
      </Text>
    );
  });
}

export function MarkdownCodeBlock({
  lang,
  value,
  narrow,
}: {
  lang: string | null;
  value: string;
  narrow: boolean;
}) {
  const { palette: t, name } = useTheme();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const tall = value.split("\n").length > COLLAPSE_LINES;
  const label = copied ? "Copied" : "Copy";
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
        <Pressable
          role="button"
          accessibilityLabel={label}
          onPress={async () => {
            const result = await copyText(value);
            setCopied(result === "copied");
            setTimeout(() => setCopied(false), 1200);
          }}
          style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
        >
          {copied ? <CheckIcon color={t.success} /> : <CopyIcon color={t.textSecondary} />}
        </Pressable>
      </View>
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
              ? ({ whiteSpace: narrow ? "pre-wrap" : "pre", overflowWrap: "anywhere" } as TextStyle)
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
    </View>
  );
}

function MarkdownTable({
  node,
  color,
  onOpenLink,
  onOpenLocalPath,
  onOpenPortPreview,
}: {
  node: Extract<MdBlock, { type: "table" }>;
  color: string;
  onOpenLink: (url: string) => void;
  onOpenLocalPath?: (path: string) => void;
  onOpenPortPreview?: (url: string) => void;
}) {
  const { palette: t, name } = useTheme();
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const web = isWeb;
  return (
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
                      align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
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
                    />
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
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
