import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import { copyText } from "./clipboard";
import { CheckIcon, CloseIcon, CopyIcon, QuoteIcon, RowsIcon, SearchIcon } from "./icons";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";
import {
  formatSelectedTableRowsMarkdown,
  queryInteractiveTable,
  type InteractiveTableData,
  type InteractiveTableRow,
} from "./uiHtmlPreview";

export interface InteractiveTableModalProps {
  visible?: boolean;
  open?: boolean;
  table: InteractiveTableData | null;
  onClose: () => void;
  onQuoteSelection?: (markdown: string) => void;
}

function InteractiveTableHeader({
  title,
  visibleCount,
  totalCount,
  onClose,
}: {
  title: string;
  visibleCount: number;
  totalCount: number;
  onClose: () => void;
}) {
  const { palette: t, name } = useTheme();
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
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
        }}
      >
        <RowsIcon color={t.onAccent} size={15} />
        <Text
          testID="interactive-table-title"
          numberOfLines={1}
          style={type(t.onAccent, 14, { fontWeight: "700" })}
        >
          {title}
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
          {`${visibleCount}/${totalCount} ROWS`}
        </Text>
      </View>

      <Pressable
        testID="interactive-table-close"
        role="button"
        accessibilityRole="button"
        accessibilityLabel="Close table"
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

function InteractiveTableToolbar({
  query,
  allVisibleSelected,
  onChangeQuery,
  onToggleSelectAll,
}: {
  query: string;
  allVisibleSelected: boolean;
  onChangeQuery: (value: string) => void;
  onToggleSelectAll: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        borderBottomWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceSecondary,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <View
        style={[
          {
            flex: 1,
            minWidth: 200,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfacePrimary,
            paddingHorizontal: 10,
            height: 34,
          },
          ctrlShadow(t, name),
        ]}
      >
        <SearchIcon color={t.textMuted} size={13} />
        <TextInput
          testID="interactive-table-search"
          accessibilityLabel="Filter table rows"
          initialValue={query}
          onChangeText={onChangeQuery}
          placeholder="Filter rows (space-separated AND terms)…"
          placeholderTextColor={t.textMuted}
          style={{
            flex: 1,
            fontSize: 12,
            color: t.textPrimary,
            paddingVertical: 0,
            ...(isWeb ? ({ outlineStyle: "none" } as object) : null),
          }}
        />
      </View>

      <Pressable
        testID="interactive-table-select-all"
        role="checkbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: allVisibleSelected }}
        accessibilityLabel="Select all"
        onPress={onToggleSelectAll}
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
              backgroundColor: allVisibleSelected
                ? t.brandAccentSoft
                : hovered
                  ? t.surfaceTertiary
                  : t.surfacePrimary,
              paddingHorizontal: 10,
              height: 34,
            },
            ctrlShadow(t, name),
          ];
        }}
      >
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: allVisibleSelected ? t.brandAccent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {allVisibleSelected ? <CheckIcon color={t.onAccent} size={10} /> : null}
        </View>
        <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Select all</Text>
      </Pressable>
    </View>
  );
}

function InteractiveTableSortHeaderRow({
  columns,
  sortColIndex,
  sortDir,
  onToggleSort,
}: {
  columns: string[];
  sortColIndex: number | null;
  sortDir: "asc" | "desc";
  onToggleSort: (colIndex: number) => void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.tableHeader,
      }}
    >
      <View
        style={{
          width: 42,
          paddingVertical: 8,
          alignItems: "center",
          justifyContent: "center",
          borderRightWidth: 1,
          borderColor: t.retroBorderLight,
        }}
      >
        <Text style={type(t.textMuted, 10, { fontWeight: "700" })}>#</Text>
      </View>
      {columns.map((col, colIndex) => {
        const isSorted = sortColIndex === colIndex;
        const arrow = isSorted ? (sortDir === "asc" ? "▲" : "▼") : "⇅";
        return (
          <Pressable
            key={colIndex}
            testID={`interactive-table-sort-${colIndex}`}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${col}`}
            {...({
              "data-sort-active": isSorted ? "true" : "false",
              "data-sort-dir": isSorted ? sortDir : "none",
            } as object)}
            onPress={() => onToggleSort(colIndex)}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              return {
                flex: 1,
                minWidth: 130,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRightWidth: colIndex < columns.length - 1 ? 1 : 0,
                borderColor: t.retroBorderLight,
                backgroundColor: isSorted
                  ? t.brandAccentSoft
                  : hovered
                    ? t.surfaceHover
                    : "transparent",
              };
            }}
          >
            <Text
              numberOfLines={1}
              style={type(isSorted ? t.onAccent : t.textPrimary, 12, {
                fontWeight: "700",
              })}
            >
              {col}
            </Text>
            <Text
              style={type(isSorted ? t.onAccent : t.textMuted, 10, {
                fontFamily: "monospace",
                fontWeight: "700",
              })}
            >
              {arrow}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InteractiveTableDataRow({
  row,
  rowIndex,
  columns,
  checked,
  onToggleRow,
}: {
  row: InteractiveTableRow;
  rowIndex: number;
  columns: string[];
  checked: boolean;
  onToggleRow: (rowId: string) => void;
}) {
  const { palette: t } = useTheme();
  return (
    <Pressable
      testID={`interactive-table-row-${rowIndex}`}
      role="checkbox"
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      {...({ "data-row-id": row.id, "data-selected": String(checked) } as object)}
      onPress={() => onToggleRow(row.id)}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return {
          flexDirection: "row",
          alignItems: "center",
          borderBottomWidth: 1,
          borderColor: t.retroBorderLight,
          backgroundColor: checked
            ? t.brandAccentSoft
            : hovered
              ? t.surfaceHover
              : rowIndex % 2 === 1
                ? t.surfaceSecondary
                : t.surfacePrimary,
        };
      }}
    >
      <View
        testID={`interactive-table-row-checkbox-${rowIndex}`}
        style={{
          width: 42,
          paddingVertical: 8,
          alignItems: "center",
          justifyContent: "center",
          borderRightWidth: 1,
          borderColor: t.retroBorderLight,
        }}
      >
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: checked ? t.brandAccent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {checked ? <CheckIcon color={t.onAccent} size={10} /> : null}
        </View>
      </View>

      {columns.map((_, cellIndex) => (
        <View
          key={cellIndex}
          style={{
            flex: 1,
            minWidth: 130,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRightWidth: cellIndex < columns.length - 1 ? 1 : 0,
            borderColor: t.retroBorderLight,
          }}
        >
          <Text
            selectable
            style={type(checked ? t.onAccent : t.textPrimary, 12, {
              fontWeight: checked ? "600" : "400",
            })}
          >
            {row.cells[cellIndex] ?? ""}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

function InteractiveTableGrid({
  columns,
  visibleRows,
  selectedSet,
  sortColIndex,
  sortDir,
  onToggleSort,
  onToggleRow,
}: {
  columns: string[];
  visibleRows: InteractiveTableRow[];
  selectedSet: ReadonlySet<string>;
  sortColIndex: number | null;
  sortDir: "asc" | "desc";
  onToggleSort: (colIndex: number) => void;
  onToggleRow: (rowId: string) => void;
}) {
  const { palette: t } = useTheme();
  return (
    <View style={{ maxHeight: 400, backgroundColor: t.surfacePrimary }}>
      <ScrollView horizontal contentContainerStyle={{ minWidth: "100%" }}>
        <View style={{ minWidth: "100%" }}>
          <InteractiveTableSortHeaderRow
            columns={columns}
            sortColIndex={sortColIndex}
            sortDir={sortDir}
            onToggleSort={onToggleSort}
          />
          <ScrollView style={{ maxHeight: 350 }}>
            {visibleRows.length === 0 ? (
              <View
                testID="interactive-table-empty"
                style={{ padding: 28, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={type(t.textMuted, 12)}>No rows match the current filter.</Text>
              </View>
            ) : (
              visibleRows.map((row, rowIndex) => (
                <InteractiveTableDataRow
                  key={row.id}
                  row={row}
                  rowIndex={rowIndex}
                  columns={columns}
                  checked={selectedSet.has(row.id)}
                  onToggleRow={onToggleRow}
                />
              ))
            )}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

function InteractiveTableFooter({
  selectedCount,
  visibleCount,
  copied,
  canQuote,
  onCopy,
  onQuote,
}: {
  selectedCount: number;
  visibleCount: number;
  copied: boolean;
  canQuote: boolean;
  onCopy: () => void;
  onQuote: () => void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        borderTopWidth: 2,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceSecondary,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <Text
        testID="interactive-table-selection-count"
        style={type(t.textSecondary, 11, { fontWeight: "600" })}
      >
        {selectedCount > 0
          ? `${selectedCount} of ${visibleCount} row(s) selected`
          : `${visibleCount} row(s) shown (select rows or copy all shown)`}
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pressable
          testID="interactive-table-copy"
          role="button"
          accessibilityRole="button"
          accessibilityLabel="Copy Selected Markdown"
          disabled={visibleCount === 0}
          onPress={onCopy}
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
                paddingHorizontal: 12,
                paddingVertical: 6,
                opacity: visibleCount === 0 ? 0.5 : 1,
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
            {copied ? "Copied Selected Markdown" : "Copy Selected Markdown"}
          </Text>
        </Pressable>

        {canQuote ? (
          <Pressable
            testID="interactive-table-quote"
            role="button"
            accessibilityRole="button"
            accessibilityLabel="Quote Selected in Chat"
            disabled={visibleCount === 0}
            onPress={onQuote}
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
                  opacity: visibleCount === 0 ? 0.5 : 1,
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <QuoteIcon color={t.onAccent} size={12} />
            <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Quote Selected in Chat</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function InteractiveTableModal({
  visible,
  open,
  table,
  onClose,
  onQuoteSelection,
}: InteractiveTableModalProps) {
  const { palette: t, name } = useTheme();
  const [query, setQuery] = useState("");
  const [sortColIndex, setSortColIndex] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setQuery("");
    setSortColIndex(null);
    setSortDir("asc");
    setSelectedIds([]);
    setCopied(false);
  }, [table]);

  const visibleRows = useMemo(
    () => (table ? queryInteractiveTable(table, { query, sortColIndex, sortDir }) : []),
    [table, query, sortColIndex, sortDir],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(
    () => visibleRows.filter((row) => selectedSet.has(row.id)),
    [visibleRows, selectedSet],
  );

  const isVisible =
    (visible ?? open ?? true) &&
    table !== null &&
    (table.columns.length > 0 || table.rows.length > 0);

  if (!isVisible || !table) {
    return null;
  }

  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((row) => selectedSet.has(row.id));

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      const visibleIdSet = new Set(visibleRows.map((row) => row.id));
      setSelectedIds((prev) => prev.filter((id) => !visibleIdSet.has(id)));
    } else {
      setSelectedIds((prev) => {
        const merged = new Set(prev);
        for (const row of visibleRows) {
          merged.add(row.id);
        }
        return Array.from(merged);
      });
    }
  };

  const handleToggleRow = (rowId: string) => {
    setSelectedIds((prev) =>
      prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId],
    );
  };

  const handleToggleColumnSort = (colIndex: number) => {
    if (sortColIndex === colIndex) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColIndex(colIndex);
      setSortDir("asc");
    }
  };

  const buildActiveMarkdown = (): string => {
    const targetRows = selectedRows.length > 0 ? selectedRows : visibleRows;
    return formatSelectedTableRowsMarkdown(table.columns, targetRows);
  };

  const handleCopyMarkdown = async () => {
    const markdown = buildActiveMarkdown();
    if (!markdown) return;
    const status = await copyText(markdown);
    if (status === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const handleQuoteInChat = () => {
    if (!onQuoteSelection) return;
    const markdown = buildActiveMarkdown();
    if (!markdown) return;
    onQuoteSelection(markdown);
    onClose();
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
          testID="interactive-table-backdrop"
          accessibilityLabel="Close interactive table"
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
          testID="interactive-table-modal"
          style={[
            {
              width: 860,
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
          <InteractiveTableHeader
            title={table.title || "Interactive Table"}
            visibleCount={visibleRows.length}
            totalCount={table.rows.length}
            onClose={onClose}
          />
          <InteractiveTableToolbar
            query={query}
            allVisibleSelected={allVisibleSelected}
            onChangeQuery={setQuery}
            onToggleSelectAll={handleToggleSelectAll}
          />
          <InteractiveTableGrid
            columns={table.columns}
            visibleRows={visibleRows}
            selectedSet={selectedSet}
            sortColIndex={sortColIndex}
            sortDir={sortDir}
            onToggleSort={handleToggleColumnSort}
            onToggleRow={handleToggleRow}
          />
          <InteractiveTableFooter
            selectedCount={selectedRows.length}
            visibleCount={visibleRows.length}
            copied={copied}
            canQuote={Boolean(onQuoteSelection)}
            onCopy={() => void handleCopyMarkdown()}
            onQuote={handleQuoteInChat}
          />
        </View>
      </View>
    </Modal>
  );
}
