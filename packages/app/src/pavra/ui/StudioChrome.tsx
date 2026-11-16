// Workspace tab chrome adapted from Bigbang StudioNamedTabBar.tsx and StudioShell.tsx.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import { listStudioGroups, OPENED_GROUP, studioKey, type StudioColumn } from "../model";
import { usePavraView } from "../store";
import { Chip } from "./ChatChrome";
import { ArrowLeftIcon, BoxesIcon, ChevronIcon, CloseIcon, MenuIcon, PlusIcon } from "./icons";
import { ctrlShadow, text as type } from "./theme";
import { useTheme } from "./ThemeProvider";

const DEFAULT_FALLBACK_GROUPS = ["General", OPENED_GROUP, "Tasks"] as const;

export interface StudioBarProps {
  columns: StudioColumn[];
  active: string | null;
  onFocus(key: string): void;
  onClose(key: string): void;
  onAdd(): void;
  onSidebar?(): void;
  /** Opens the collaboration panel for the active tab group (Paseo addition). */
  onCollaborate?(): void;
  /** Opens the Studio port preview dialog. */
  onOpenPortPreview?(): void;
  /** Optional extra group names to include alongside column groups. */
  extraGroups?: readonly string[];
  /** Optional active group override. */
  activeGroup?: string | null;
  /** Optional callback when a group pill is focused. */
  onSelectGroup?(group: string): void;
  /** Optional callback when a new group is created. */
  onAddGroup?(group: string): void;
  /** Optional callback when a group is renamed. */
  onRenameGroup?(oldGroup: string, newGroup: string): void;
  /** Optional callback when a column is moved to another group. */
  onMoveColumnToGroup?(key: string, targetGroup: string): void;
  /** Optional callback when a column is reordered left or right. */
  onReorderColumn?(key: string, direction: "left" | "right"): void;
}

function resolveCurrentStudioGroup(input: {
  activeGroupProp?: string | null;
  selectedGroup: string | null;
  activeColumnGroup?: string;
  storeActiveGroup: string | null;
  groups: readonly string[];
}): string {
  if (input.activeGroupProp) return input.activeGroupProp;
  if (input.selectedGroup && input.groups.includes(input.selectedGroup)) {
    return input.selectedGroup;
  }
  if (input.activeColumnGroup) return input.activeColumnGroup;
  if (input.storeActiveGroup && input.groups.includes(input.storeActiveGroup)) {
    return input.storeActiveGroup;
  }
  return input.groups[0] ?? "General";
}

export function StudioBar({
  columns,
  active,
  onFocus,
  onClose,
  onAdd,
  onSidebar,
  onCollaborate,
  onOpenPortPreview,
  extraGroups,
  activeGroup: activeGroupProp,
  onSelectGroup,
  onAddGroup,
  onRenameGroup,
  onMoveColumnToGroup,
  onReorderColumn,
}: StudioBarProps) {
  const { palette: t, name } = useTheme();
  const storeExtraGroups = usePavraView((state) => state.extraGroups);
  const storeActiveGroup = usePavraView((state) => state.activeGroup);
  const [localExtraGroups, setLocalExtraGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupDraft, setNewGroupDraft] = useState("");
  const [renamingGroup, setRenamingGroup] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [movingColumnKey, setMovingColumnKey] = useState<string | null>(null);
  const [moveTargetDraft, setMoveTargetDraft] = useState("");

  const mergedGroups = listStudioGroups(columns, [
    ...(extraGroups ?? []),
    ...storeExtraGroups,
    ...localExtraGroups,
  ]);
  const groups = mergedGroups.length > 0 ? mergedGroups : ["General"];
  const activeColumnObj = columns.find((col) => studioKey(col) === active);

  useEffect(() => {
    if (storeActiveGroup) {
      setSelectedGroup(storeActiveGroup);
    } else if (activeColumnObj?.group) {
      setSelectedGroup(activeColumnObj.group);
    }
  }, [activeColumnObj?.group, storeActiveGroup]);

  const currentGroup = resolveCurrentStudioGroup({
    activeGroupProp,
    selectedGroup,
    activeColumnGroup: activeColumnObj?.group,
    storeActiveGroup,
    groups,
  });

  const handleSelectGroup = (group: string) => {
    const trimmed = group.trim();
    if (!trimmed) return;
    setSelectedGroup(trimmed);
    setRenamingGroup(false);
    usePavraView.getState().focusGroup(trimmed);
    onSelectGroup?.(trimmed);
    const firstInGroup = columns.find((col) => col.group === trimmed);
    if (firstInGroup && activeColumnObj?.group !== trimmed) {
      onFocus(studioKey(firstInGroup));
    }
  };

  const handleConfirmAddGroup = () => {
    const trimmed = newGroupDraft.trim();
    if (!trimmed) return;
    setLocalExtraGroups((prev) => listStudioGroups([], [...prev, trimmed]));
    setSelectedGroup(trimmed);
    usePavraView.getState().addGroup(trimmed);
    onAddGroup?.(trimmed);
    setNewGroupDraft("");
    setAddingGroup(false);
  };

  const handleStartRename = () => {
    setAddingGroup(false);
    setMovingColumnKey(null);
    setRenameDraft(currentGroup);
    setRenamingGroup(true);
  };

  const handleConfirmRenameGroup = () => {
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    const oldGroup = currentGroup;
    if (trimmed !== oldGroup) {
      setLocalExtraGroups((prev) =>
        listStudioGroups(
          [],
          prev.map((item) => (item === oldGroup ? trimmed : item)).concat(trimmed),
        ),
      );
      setSelectedGroup(trimmed);
      usePavraView.getState().renameGroup(oldGroup, trimmed);
      onRenameGroup?.(oldGroup, trimmed);
    }
    setRenamingGroup(false);
  };

  const handleReorder = (key: string, direction: "left" | "right") => {
    usePavraView.getState().reorderColumn(key, direction);
    onReorderColumn?.(key, direction);
  };

  const handleMoveToGroup = (key: string, targetGroup: string) => {
    const trimmed = targetGroup.trim();
    if (!trimmed) return;
    setLocalExtraGroups((prev) => listStudioGroups([], [...prev, trimmed]));
    setSelectedGroup(trimmed);
    usePavraView.getState().moveColumnToGroup(key, trimmed);
    onMoveColumnToGroup?.(key, trimmed);
    onFocus(key);
    setMovingColumnKey(null);
    setMoveTargetDraft("");
  };

  const movingColumn = movingColumnKey
    ? columns.find((col) => studioKey(col) === movingColumnKey)
    : undefined;
  const moveCandidateGroups = listStudioGroups(columns, [
    ...groups,
    ...DEFAULT_FALLBACK_GROUPS,
  ]).filter((g) => g !== movingColumn?.group);

  return (
    <View
      style={{
        backgroundColor: t.surfacePrimary,
        borderBottomWidth: 2,
        borderBottomColor: t.black,
      }}
    >
      <StudioBarHeader
        onSidebar={onSidebar}
        onOpenPortPreview={onOpenPortPreview}
        onCollaborate={onCollaborate}
        onAdd={onAdd}
      />
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          gap: 8,
          alignItems: "center",
        }}
      >
        {groups.map((group) => (
          <StudioGroupSection
            key={group}
            group={group}
            groupSelected={group === currentGroup}
            groupColumns={columns.filter((column) => column.group === group)}
            activeKey={active}
            onSelectGroup={handleSelectGroup}
            onFocus={onFocus}
            onClose={onClose}
            onReorder={handleReorder}
            onToggleMoveMenu={(key) => {
              setAddingGroup(false);
              setRenamingGroup(false);
              setMovingColumnKey((prev) => (prev === key ? null : key));
            }}
          />
        ))}
        <Pressable
          testID="studio-add-group-btn"
          role="button"
          accessibilityLabel="Add group"
          onPress={() => {
            setRenamingGroup(false);
            setMovingColumnKey(null);
            setAddingGroup((prev) => !prev);
          }}
          style={{
            height: 26,
            paddingHorizontal: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfaceElevated,
            justifyContent: "center",
          }}
        >
          <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>+ Group</Text>
        </Pressable>
        <Pressable
          testID="studio-rename-group-btn"
          role="button"
          accessibilityLabel="Rename Group"
          onPress={handleStartRename}
          style={{
            height: 26,
            paddingHorizontal: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorderLight,
            backgroundColor: t.surfaceElevated,
            justifyContent: "center",
          }}
        >
          <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>Rename Group</Text>
        </Pressable>
        <Pressable
          role="button"
          accessibilityLabel="Add workspace"
          onPress={onAdd}
          style={[
            {
              height: 26,
              width: 26,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              alignItems: "center",
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          <PlusIcon color={t.textSecondary} size={14} />
        </Pressable>
      </ScrollView>
      {addingGroup ? (
        <StudioAddGroupRow
          draft={newGroupDraft}
          onChangeDraft={setNewGroupDraft}
          onConfirm={handleConfirmAddGroup}
          onCancel={() => {
            setAddingGroup(false);
            setNewGroupDraft("");
          }}
        />
      ) : null}
      {renamingGroup ? (
        <StudioRenameGroupRow
          currentGroup={currentGroup}
          draft={renameDraft}
          onChangeDraft={setRenameDraft}
          onConfirm={handleConfirmRenameGroup}
          onCancel={() => setRenamingGroup(false)}
        />
      ) : null}
      {movingColumnKey && movingColumn ? (
        <StudioMoveColumnRow
          columnName={movingColumn.name}
          candidateGroups={moveCandidateGroups}
          draft={moveTargetDraft}
          onChangeDraft={setMoveTargetDraft}
          onSelectTarget={(targetGroup) => handleMoveToGroup(movingColumnKey, targetGroup)}
          onCancel={() => {
            setMovingColumnKey(null);
            setMoveTargetDraft("");
          }}
        />
      ) : null}
    </View>
  );
}

function StudioBarHeader({
  onSidebar,
  onOpenPortPreview,
  onCollaborate,
  onAdd,
}: {
  onSidebar?(): void;
  onOpenPortPreview?(): void;
  onCollaborate?(): void;
  onAdd(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <View
      style={{
        height: 44,
        paddingHorizontal: 12,
        flexDirection: "row",
        gap: 10,
        alignItems: "center",
      }}
    >
      {onSidebar ? (
        <Pressable role="button" accessibilityLabel="Open sidebar" onPress={onSidebar}>
          <MenuIcon color={t.textSecondary} size={18} />
        </Pressable>
      ) : null}
      <BoxesIcon color={t.brandAccent} size={18} />
      <Text style={type(t.textPrimary, 14, { fontWeight: "700", flex: 1 })}>Studio</Text>
      {onOpenPortPreview ? (
        <Pressable
          testID="studio-port-preview-btn"
          role="button"
          accessibilityLabel="Port Preview"
          onPress={onOpenPortPreview}
          style={[
            {
              minHeight: 26,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceElevated,
              paddingHorizontal: 10,
              justifyContent: "center",
            },
            ctrlShadow(t, name),
          ]}
        >
          <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>Port Preview</Text>
        </Pressable>
      ) : null}
      {onCollaborate ? <Chip onPress={onCollaborate}>Collaboration</Chip> : null}
      <Chip onPress={onAdd}>Add workspace</Chip>
    </View>
  );
}

function StudioGroupSection({
  group,
  groupSelected,
  groupColumns,
  activeKey,
  onSelectGroup,
  onFocus,
  onClose,
  onReorder,
  onToggleMoveMenu,
}: {
  group: string;
  groupSelected: boolean;
  groupColumns: StudioColumn[];
  activeKey: string | null;
  onSelectGroup(group: string): void;
  onFocus(key: string): void;
  onClose(key: string): void;
  onReorder(key: string, direction: "left" | "right"): void;
  onToggleMoveMenu(key: string): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
      <Pressable
        testID={`studio-group-pill-${group}`}
        role="button"
        accessibilityLabel={`Group ${group}`}
        accessibilityState={{ selected: groupSelected }}
        onPress={() => onSelectGroup(group)}
        style={{
          height: 28,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: groupSelected ? t.brandAccent : t.retroBorderLight,
          backgroundColor: groupSelected ? t.brandAccentSoft : t.surfaceHover,
          paddingHorizontal: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Text
          style={type(groupSelected ? t.onAccent : t.textSecondary, 11, {
            fontWeight: "700",
          })}
        >
          {group}
        </Text>
        {groupColumns.length > 0 ? (
          <Text
            style={type(groupSelected ? t.onAccent : t.textMuted, 10, {
              fontWeight: "700",
            })}
          >
            {groupColumns.length}
          </Text>
        ) : null}
      </Pressable>
      {groupColumns.map((column, indexInGroup) => {
        const key = studioKey(column);
        const selected = key === activeKey;
        const canMoveLeft = indexInGroup > 0;
        const canMoveRight = indexInGroup < groupColumns.length - 1;
        return (
          <View
            key={key}
            testID="studio-tab-item"
            style={{
              position: "relative",
              flexDirection: "row",
              alignItems: "center",
              height: 28,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: selected ? t.retroBorderLight : "transparent",
              backgroundColor: selected ? t.surfaceElevated : "transparent",
              paddingHorizontal: 8,
              gap: 4,
              flexShrink: 0,
            }}
          >
            <Pressable
              role="button"
              accessibilityLabel={column.name}
              accessibilityState={{ selected }}
              onPress={() => onFocus(key)}
              style={{ maxWidth: 200 }}
            >
              <Text
                numberOfLines={1}
                style={type(selected ? t.brandAccent : t.textSecondary, 11, {
                  fontWeight: "600",
                })}
              >
                {column.name}
              </Text>
            </Pressable>
            <Pressable
              testID={`studio-tab-move-left-${column.workspaceId}`}
              role="button"
              accessibilityLabel="Move left"
              disabled={!canMoveLeft}
              onPress={() => onReorder(key, "left")}
              style={{
                width: 16,
                height: 16,
                alignItems: "center",
                justifyContent: "center",
                opacity: canMoveLeft ? 1 : 0.35,
              }}
            >
              <ArrowLeftIcon color={t.textMuted} size={11} />
            </Pressable>
            <Pressable
              testID={`studio-tab-move-right-${column.workspaceId}`}
              role="button"
              accessibilityLabel="Move right"
              disabled={!canMoveRight}
              onPress={() => onReorder(key, "right")}
              style={{
                width: 16,
                height: 16,
                alignItems: "center",
                justifyContent: "center",
                opacity: canMoveRight ? 1 : 0.35,
              }}
            >
              <ChevronIcon color={t.textMuted} size={11} />
            </Pressable>
            <Pressable
              testID={`studio-tab-move-group-${column.workspaceId}`}
              role="button"
              accessibilityLabel="Move to group"
              onPress={() => onToggleMoveMenu(key)}
              style={{
                height: 18,
                paddingHorizontal: 4,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: t.retroBorderLight,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={type(t.textMuted, 9, { fontWeight: "700" })}>Move to group</Text>
            </Pressable>
            <Pressable
              role="button"
              accessibilityLabel={`Close workspace view ${column.name}`}
              onPress={() => onClose(key)}
              style={{
                width: 16,
                height: 16,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CloseIcon color={t.textMuted} size={12} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function StudioAddGroupRow({
  draft,
  onChangeDraft,
  onConfirm,
  onCancel,
}: {
  draft: string;
  onChangeDraft(value: string): void;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      testID="studio-add-group-popover"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderTopWidth: 1,
        borderTopColor: t.retroBorderLight,
        backgroundColor: t.surfaceSecondary,
      }}
    >
      <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>New group:</Text>
      <EditingTextInput
        testID="studio-add-group-input"
        accessibilityLabel="New group name"
        placeholder="Group name…"
        placeholderTextColor={t.textMuted}
        initialValue={draft}
        autoFocus
        onChangeText={onChangeDraft}
        onSubmitEditing={onConfirm}
        style={{
          minWidth: 140,
          height: 26,
          paddingHorizontal: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfacePrimary,
          color: t.textPrimary,
          fontSize: 12,
        }}
      />
      <Pressable
        testID="studio-add-group-confirm"
        role="button"
        accessibilityLabel="Create group"
        onPress={onConfirm}
        style={{
          height: 26,
          paddingHorizontal: 10,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.brandAccent,
          justifyContent: "center",
        }}
      >
        <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Create</Text>
      </Pressable>
      <Pressable
        testID="studio-add-group-cancel"
        role="button"
        accessibilityLabel="Cancel add group"
        onPress={onCancel}
        style={{
          height: 26,
          paddingHorizontal: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorderLight,
          justifyContent: "center",
        }}
      >
        <Text style={type(t.textSecondary, 11)}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function StudioRenameGroupRow({
  currentGroup,
  draft,
  onChangeDraft,
  onConfirm,
  onCancel,
}: {
  currentGroup: string;
  draft: string;
  onChangeDraft(value: string): void;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      testID="studio-rename-group-popover"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderTopWidth: 1,
        borderTopColor: t.retroBorderLight,
        backgroundColor: t.surfaceSecondary,
      }}
    >
      <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>
        {`Rename "${currentGroup}":`}
      </Text>
      <EditingTextInput
        testID="studio-rename-group-input"
        accessibilityLabel="Rename group"
        initialValue={draft}
        autoFocus
        onChangeText={onChangeDraft}
        onSubmitEditing={onConfirm}
        style={{
          minWidth: 140,
          height: 26,
          paddingHorizontal: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.surfacePrimary,
          color: t.textPrimary,
          fontSize: 12,
        }}
      />
      <Pressable
        testID="studio-rename-group-confirm"
        role="button"
        accessibilityLabel="Save group name"
        onPress={onConfirm}
        style={{
          height: 26,
          paddingHorizontal: 10,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorder,
          backgroundColor: t.brandAccent,
          justifyContent: "center",
        }}
      >
        <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Save</Text>
      </Pressable>
      <Pressable
        testID="studio-rename-group-cancel"
        role="button"
        accessibilityLabel="Cancel rename group"
        onPress={onCancel}
        style={{
          height: 26,
          paddingHorizontal: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorderLight,
          justifyContent: "center",
        }}
      >
        <Text style={type(t.textSecondary, 11)}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function StudioMoveColumnRow({
  columnName,
  candidateGroups,
  draft,
  onChangeDraft,
  onSelectTarget,
  onCancel,
}: {
  columnName: string;
  candidateGroups: string[];
  draft: string;
  onChangeDraft(value: string): void;
  onSelectTarget(group: string): void;
  onCancel(): void;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      testID="studio-move-group-menu"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderTopWidth: 1,
        borderTopColor: t.retroBorderLight,
        backgroundColor: t.surfaceSecondary,
      }}
    >
      <Text style={type(t.textSecondary, 11, { fontWeight: "600" })}>
        {`Move "${columnName}" to group:`}
      </Text>
      {candidateGroups.map((targetGroup) => (
        <Pressable
          key={targetGroup}
          testID={`studio-move-target-${targetGroup}`}
          role="button"
          accessibilityLabel={`Move to ${targetGroup}`}
          onPress={() => onSelectTarget(targetGroup)}
          style={{
            height: 24,
            paddingHorizontal: 8,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceElevated,
            justifyContent: "center",
          }}
        >
          <Text style={type(t.textPrimary, 11, { fontWeight: "600" })}>{targetGroup}</Text>
        </Pressable>
      ))}
      <EditingTextInput
        testID="studio-move-group-input"
        accessibilityLabel="Target group name"
        placeholder="Or type group…"
        placeholderTextColor={t.textMuted}
        initialValue={draft}
        onChangeText={onChangeDraft}
        onSubmitEditing={() => onSelectTarget(draft)}
        style={{
          minWidth: 110,
          height: 24,
          paddingHorizontal: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorderLight,
          backgroundColor: t.surfacePrimary,
          color: t.textPrimary,
          fontSize: 11,
        }}
      />
      {draft.trim() ? (
        <Pressable
          testID="studio-move-group-confirm"
          role="button"
          accessibilityLabel="Confirm move to group"
          onPress={() => onSelectTarget(draft)}
          style={{
            height: 24,
            paddingHorizontal: 8,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.brandAccent,
            justifyContent: "center",
          }}
        >
          <Text style={type(t.onAccent, 11, { fontWeight: "700" })}>Move</Text>
        </Pressable>
      ) : null}
      <Pressable
        testID="studio-move-group-cancel"
        role="button"
        accessibilityLabel="Cancel move to group"
        onPress={onCancel}
        style={{
          height: 24,
          paddingHorizontal: 8,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: t.retroBorderLight,
          justifyContent: "center",
        }}
      >
        <Text style={type(t.textSecondary, 11)}>Cancel</Text>
      </Pressable>
    </View>
  );
}

export function WorkspaceChrome({
  label,
  connected,
  selected,
  onFocus,
  onMoveLeft,
  onMoveRight,
  onMoveToGroup,
  children,
}: {
  label: string;
  connected: boolean;
  selected: boolean;
  onFocus(): void;
  onMoveLeft?(): void;
  onMoveRight?(): void;
  onMoveToGroup?(): void;
  children: React.ReactNode;
}) {
  const { palette: t } = useTheme();
  return (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onStartShouldSetResponderCapture={() => {
        onFocus();
        return false;
      }}
    >
      <View
        style={{
          height: 34,
          paddingHorizontal: 10,
          borderBottomWidth: 1,
          borderBottomColor: t.retroBorderLight,
          flexDirection: "row",
          gap: 6,
          alignItems: "center",
          backgroundColor: t.surfaceSecondary,
        }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: connected ? t.success : t.destructive,
          }}
        />
        <Pressable
          role="button"
          accessibilityLabel={`Focus ${label}`}
          onPress={onFocus}
          style={{ flex: 1 }}
        >
          <Text
            numberOfLines={1}
            style={type(selected ? t.textPrimary : t.textMuted, 11, { fontWeight: "600" })}
          >
            {label}
            {connected ? "" : " · offline"}
          </Text>
        </Pressable>
        {onMoveLeft ? (
          <Pressable role="button" accessibilityLabel="Move left" onPress={onMoveLeft}>
            <ArrowLeftIcon color={t.textMuted} size={12} />
          </Pressable>
        ) : null}
        {onMoveRight ? (
          <Pressable role="button" accessibilityLabel="Move right" onPress={onMoveRight}>
            <ChevronIcon color={t.textMuted} size={12} />
          </Pressable>
        ) : null}
        {onMoveToGroup ? (
          <Pressable role="button" accessibilityLabel="Move to group" onPress={onMoveToGroup}>
            <Text style={type(t.textMuted, 10, { fontWeight: "600" })}>Move to group</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}
