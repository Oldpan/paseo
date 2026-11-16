import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useIsCompactFormFactor } from "@/constants/layout";
import { EditingTextInput } from "@/components/ui/text-input";
import type {
  Assistant,
  AssistantNoteCategory,
  AssistantNoteSummary,
} from "../../../../../extensions/pavra/shared/contracts";
import type { PavraData } from "../data";
import {
  groupNotesByCategory,
  useAssistantNotesTree,
  type NoteCategoryGroup,
  type NotesTreeModel,
} from "../memory";
import { Chip } from "./ChatChrome";
import { FileTextIcon, FolderIcon, PlusIcon, RefreshIcon, TrashIcon } from "./icons";
import { ctrlShadow, selectedFillProps, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

export interface MemoryNotesSectionProps {
  data: Pick<PavraData, "invoke" | "connected">;
  assistant?: Assistant;
  tree?: NotesTreeModel;
  onEdit?(): void;
}

const NEW_NOTE_CATEGORIES: ReadonlyArray<{
  id: AssistantNoteCategory;
  label: string;
}> = [
  { id: "general", label: "General" },
  { id: "channels", label: "Channel" },
  { id: "work-log", label: "Work Log" },
  { id: "archive", label: "Archive" },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function describeNotePath(selectedPath: string, assistantName?: string): string {
  if (selectedPath === "MEMORY.md") {
    return `${assistantName ?? "This assistant"} reads MEMORY.md (up to 200 lines) on every fresh session as its long-term index.`;
  }
  if (selectedPath === "notes/user-preferences.md") {
    return "Durable user preferences injected automatically into fresh chat sessions.";
  }
  return `Scoped markdown note stored at ${selectedPath} in the assistant's home directory.`;
}

function editorPlaceholder(loading: boolean, selectedPath: string, selectedTitle?: string): string {
  if (loading) return "Loading…";
  if (selectedPath === "MEMORY.md") return "No memories saved yet.";
  return `# ${selectedTitle ?? selectedPath}`;
}

export function MemoryNotesSection({
  data,
  assistant,
  tree: externalTree,
  onEdit,
}: MemoryNotesSectionProps) {
  const { palette: t } = useTheme();
  const compact = useIsCompactFormFactor();
  const internalTree = useAssistantNotesTree(data, externalTree ? undefined : assistant?.id);
  const model = externalTree ?? internalTree;
  const groups = useMemo(() => groupNotesByCategory(model.notes), [model.notes]);

  return (
    <View
      testID="memory-notes-section"
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: t.chatSurface,
        flexDirection: compact ? "column" : "row",
      }}
    >
      <NotesTreeSidebar assistant={assistant} compact={compact} groups={groups} model={model} />
      <NoteEditorPane assistant={assistant} compact={compact} model={model} onEdit={onEdit} />
    </View>
  );
}

function NotesTreeSidebar({
  assistant,
  compact,
  groups,
  model,
}: {
  assistant?: Assistant;
  compact: boolean;
  groups: ReadonlyArray<NoteCategoryGroup>;
  model: NotesTreeModel;
}) {
  const { palette: t, name } = useTheme();
  const [creating, setCreating] = useState(false);
  const [newNoteInput, setNewNoteInput] = useState("");
  const [newNoteCategory, setNewNoteCategory] = useState<AssistantNoteCategory>("general");
  const [newInputKey, setNewInputKey] = useState(0);

  const handleToggleNew = useCallback(() => {
    setCreating((prev) => !prev);
  }, []);

  const handleCreateSubmit = useCallback(() => {
    const trimmed = newNoteInput.trim();
    if (!trimmed) return;
    const createdPath = model.create(trimmed, newNoteCategory);
    if (createdPath) {
      setNewNoteInput("");
      setNewInputKey((prev) => prev + 1);
      setCreating(false);
    }
  }, [model, newNoteCategory, newNoteInput]);

  const newDisabled = !assistant || model.saving;

  return (
    <View
      style={{
        width: compact ? "100%" : 280,
        maxHeight: compact ? 290 : undefined,
        borderRightWidth: compact ? 0 : 2,
        borderBottomWidth: compact ? 2 : 0,
        borderColor: t.black,
        backgroundColor: t.surfacePrimary,
        flexShrink: 0,
      }}
    >
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: t.dividerLine,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type(t.textPrimary, 14, { fontWeight: "800" })}>Memory & Notes</Text>
          <Text numberOfLines={1} style={type(t.textMuted, 11, { marginTop: 1 })}>
            {assistant?.name ?? "Assistant"} workspace files
          </Text>
        </View>
        <Pressable
          testID="memory-note-new-btn"
          role="button"
          accessibilityLabel="New note"
          disabled={newDisabled}
          onPress={handleToggleNew}
          style={(state) => {
            const hovered = Boolean((state as { hovered?: boolean }).hovered);
            return [
              {
                height: 30,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: creating
                  ? t.brandAccent
                  : hovered
                    ? t.surfaceHover
                    : t.surfaceElevated,
                paddingHorizontal: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                opacity: newDisabled ? 0.5 : 1,
                ...webTransition("background-color 120ms ease"),
              },
              ctrlShadow(t, name),
            ];
          }}
        >
          <PlusIcon color={creating ? t.onAccent : t.textPrimary} size={11} />
          <Text style={type(creating ? t.onAccent : t.textPrimary, 11, { fontWeight: "700" })}>
            New Note
          </Text>
        </Pressable>
      </View>

      {creating ? (
        <NewNoteCreator
          inputKey={newInputKey}
          value={newNoteInput}
          category={newNoteCategory}
          onChangeValue={setNewNoteInput}
          onChangeCategory={setNewNoteCategory}
          onSubmit={handleCreateSubmit}
        />
      ) : null}

      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ padding: 10, gap: 10 }}
        keyboardShouldPersistTaps="handled"
      >
        {groups.map((group) => (
          <View key={group.category} style={{ gap: 4 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 6,
              }}
            >
              <FolderIcon color={t.textMuted} size={11} />
              <Text
                style={type(t.textMuted, 10, {
                  fontWeight: "800",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  flex: 1,
                })}
              >
                {group.label}
              </Text>
              <Text style={type(t.textSubtle, 10, { fontWeight: "700" })}>
                {group.notes.length}
              </Text>
            </View>
            {group.notes.length === 0 ? (
              <Text style={type(t.textSubtle, 11, { paddingHorizontal: 8, paddingVertical: 2 })}>
                None yet
              </Text>
            ) : (
              group.notes.map((note) => (
                <NoteTreeItem
                  key={note.path}
                  note={note}
                  selected={model.selectedPath === note.path}
                  disabled={model.saving}
                  onSelect={() => model.select(note.path)}
                />
              ))
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function NewNoteCreator({
  inputKey,
  value,
  category,
  onChangeValue,
  onChangeCategory,
  onSubmit,
}: {
  inputKey: number;
  value: string;
  category: AssistantNoteCategory;
  onChangeValue(text: string): void;
  onChangeCategory(cat: AssistantNoteCategory): void;
  onSubmit(): void;
}) {
  const { palette: t, name } = useTheme();
  const canSubmit = value.trim().length > 0;
  return (
    <View
      style={{
        padding: 12,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: t.retroBorder,
        backgroundColor: t.surfaceSecondary,
      }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {NEW_NOTE_CATEGORIES.map((cat) => {
          const selected = category === cat.id;
          return (
            <Pressable
              key={cat.id}
              testID={`memory-note-new-category-${cat.id}`}
              role="button"
              accessibilityLabel={`Note category ${cat.label}`}
              accessibilityState={{ selected }}
              onPress={() => onChangeCategory(cat.id)}
              {...selectedFillProps(selected)}
              style={{
                height: 24,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: selected ? t.brandAccent : t.surfaceElevated,
                paddingHorizontal: 8,
                justifyContent: "center",
              }}
            >
              <Text
                style={type(selected ? t.onAccent : t.textSecondary, 10, {
                  fontWeight: "700",
                })}
              >
                {cat.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <EditingTextInput
          key={inputKey}
          testID="memory-note-new-input"
          accessibilityLabel="New note slug or path"
          initialValue={value}
          onChangeText={onChangeValue}
          onSubmitEditing={onSubmit}
          placeholder={`notes/${category}/slug.md`}
          placeholderTextColor={t.textSubtle}
          style={[
            type(t.textPrimary, 12),
            {
              flex: 1,
              minHeight: 32,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfacePrimary,
              paddingHorizontal: 8,
              paddingVertical: 5,
            },
          ]}
        />
        <Pressable
          testID="memory-note-create-submit"
          role="button"
          accessibilityLabel="Create note"
          disabled={!canSubmit}
          onPress={onSubmit}
          style={[
            {
              height: 32,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.brandAccent,
              paddingHorizontal: 10,
              justifyContent: "center",
              opacity: canSubmit ? 1 : 0.5,
            },
            ctrlShadow(t, name),
          ]}
        >
          <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Create</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NoteEditorPane({
  assistant,
  compact,
  model,
  onEdit,
}: {
  assistant?: Assistant;
  compact: boolean;
  model: NotesTreeModel;
  onEdit?(): void;
}) {
  const { palette: t, name } = useTheme();
  const busy = model.saving || model.loading;

  return (
    <ScrollView
      style={{ flex: 1, minHeight: 0, minWidth: 0 }}
      contentContainerStyle={{ padding: compact ? 14 : 20, gap: 12, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <View
            testID="memory-note-path-badge"
            style={[
              {
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.surfaceElevated,
                paddingHorizontal: 10,
                paddingVertical: 5,
              },
              ctrlShadow(t, name),
            ]}
          >
            <FileTextIcon color={t.textPrimary} size={13} />
            <Text style={type(t.textPrimary, 12, { fontWeight: "700" })}>{model.selectedPath}</Text>
          </View>
          {model.dirty ? (
            <View
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.badgeAmber,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text style={type(t.textPrimary, 10, { fontWeight: "700" })}>Unsaved</Text>
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Pressable
            testID="memory-note-save-btn"
            role="button"
            accessibilityLabel="Save note"
            disabled={busy}
            onPress={model.save}
            style={[
              {
                minHeight: 30,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.brandAccent,
                paddingHorizontal: 12,
                justifyContent: "center",
                opacity: busy ? 0.45 : 1,
              },
              ctrlShadow(t, name),
            ]}
          >
            <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>
              {model.saving ? "Saving…" : "Save"}
            </Text>
          </Pressable>

          <Pressable
            testID="memory-note-reload-btn"
            role="button"
            accessibilityLabel="Reload note"
            disabled={busy}
            onPress={model.reload}
            style={[
              {
                minHeight: 30,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: t.retroBorder,
                backgroundColor: t.surfaceElevated,
                paddingHorizontal: 11,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                opacity: busy ? 0.45 : 1,
              },
              ctrlShadow(t, name),
            ]}
          >
            <RefreshIcon color={t.textSecondary} size={12} />
            <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>Reload</Text>
          </Pressable>

          {model.canDelete ? (
            <Pressable
              testID="memory-note-delete-btn"
              role="button"
              accessibilityLabel="Delete note"
              disabled={busy}
              onPress={() => model.remove(model.selectedPath)}
              style={[
                {
                  minHeight: 30,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.badgeRed,
                  paddingHorizontal: 11,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  opacity: busy ? 0.45 : 1,
                },
                ctrlShadow(t, name),
              ]}
            >
              <TrashIcon color={t.textPrimary} size={12} />
              <Text style={type(t.textPrimary, 11, { fontWeight: "700" })}>Delete</Text>
            </Pressable>
          ) : null}

          {onEdit ? <Chip onPress={onEdit}>Edit persona and model</Chip> : null}
        </View>
      </View>

      <Text style={type(t.textMuted, 12)}>
        {describeNotePath(model.selectedPath, assistant?.name)}
      </Text>

      {model.error ? (
        <View
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.destructive,
            backgroundColor: t.surfaceElevated,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
            {model.error}
          </Text>
        </View>
      ) : null}

      {assistant ? (
        <EditingTextInput
          key={`${model.selectedPath}:${model.editorKey}`}
          testID="memory-note-editor"
          accessibilityLabel={`Note editor for ${model.selectedPath}`}
          initialValue={model.content}
          onChangeText={model.change}
          multiline
          editable={!busy}
          placeholder={editorPlaceholder(
            model.loading,
            model.selectedPath,
            model.selectedNote?.title,
          )}
          placeholderTextColor={t.textSubtle}
          style={[
            type(t.textPrimary, 13),
            {
              flex: 1,
              minHeight: 320,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfacePrimary,
              paddingHorizontal: 12,
              paddingVertical: 10,
              textAlignVertical: "top",
            },
          ]}
        />
      ) : null}
    </ScrollView>
  );
}

function NoteTreeItem({
  note,
  selected,
  disabled,
  onSelect,
}: {
  note: AssistantNoteSummary;
  selected: boolean;
  disabled: boolean;
  onSelect(): void;
}) {
  const { palette: t, name } = useTheme();
  const displayName =
    note.path === "MEMORY.md"
      ? "MEMORY.md"
      : note.path === "notes/user-preferences.md"
        ? "user-preferences.md"
        : note.path.replace(/^notes\/(?:channels\/|work-log\/|archive\/|general\/)?/, "");

  return (
    <Pressable
      testID={`memory-note-item-${note.path}`}
      role="button"
      accessibilityLabel={`Select note ${note.path}`}
      accessibilityState={{ selected }}
      disabled={disabled}
      onPress={onSelect}
      {...selectedFillProps(selected)}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            minHeight: 34,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: selected ? t.retroBorder : "transparent",
            backgroundColor: selected
              ? hovered
                ? t.brandAccentHover
                : t.brandAccent
              : hovered
                ? t.surfaceHover
                : "transparent",
            paddingHorizontal: 9,
            paddingVertical: 5,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            ...webTransition("background-color 120ms ease"),
          },
          selected ? ctrlShadow(t, name) : null,
        ];
      }}
    >
      <FileTextIcon color={selected ? t.onAccent : t.textSecondary} size={13} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={type(selected ? t.onAccent : t.textPrimary, 12, {
            fontWeight: selected ? "700" : "600",
          })}
        >
          {displayName}
        </Text>
        {note.title && note.title !== displayName && note.title !== note.path ? (
          <Text
            numberOfLines={1}
            style={type(selected ? t.onAccent : t.textMuted, 10, {
              opacity: selected ? 0.85 : 1,
            })}
          >
            {note.title}
          </Text>
        ) : null}
      </View>
      {note.mtimeMs > 0 ? (
        <Text
          style={type(selected ? t.onAccent : t.textSubtle, 10, {
            fontWeight: "600",
          })}
        >
          {formatBytes(note.sizeBytes)}
        </Text>
      ) : null}
    </Pressable>
  );
}
