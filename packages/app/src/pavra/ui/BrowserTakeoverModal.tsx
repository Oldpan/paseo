import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import {
  browserPageState,
  browserRemoteAction,
  cancelTakeover,
  resolveTakeover,
  type BrowserElement,
  type BrowserPageState,
  type Takeover,
} from "../../../../../extensions/pavra/shared/contracts";
import type { PavraData } from "../data";
import { FormFrame, PavraInput } from "./FormChrome";
import { ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";

function ActionButton({
  children,
  testID,
  label,
  accent = false,
  disabled = false,
  onPress,
}: {
  children: ReactNode;
  testID?: string;
  label?: string;
  accent?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  const { palette: t, name } = useTheme();
  return (
    <Pressable
      testID={testID}
      role="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={(state) => {
        const hovered = Boolean((state as { hovered?: boolean }).hovered);
        return [
          {
            minHeight: 28,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: accent
              ? hovered
                ? t.brandAccentHover
                : t.brandAccent
              : hovered
                ? t.surfaceHover
                : t.surfacePrimary,
            paddingHorizontal: 11,
            justifyContent: "center",
            opacity: disabled ? 0.45 : 1,
            ...webTransition("background-color 120ms ease"),
          },
          ctrlShadow(t, name),
        ];
      }}
    >
      <Text style={type(accent ? t.onAccent : t.textPrimary, 11, { fontWeight: "600" })}>
        {children}
      </Text>
    </Pressable>
  );
}

export function TakeoverCard({
  takeover,
  assistantName,
  conversationName,
  testID,
  busy = false,
  onOpenTakeover,
  onResolve,
  onCancel,
  onOpenConversation,
}: {
  takeover: Takeover;
  assistantName: string;
  conversationName?: string;
  testID?: string;
  busy?: boolean;
  onOpenTakeover(takeover: Takeover): void;
  onResolve(takeoverId: string): void;
  onCancel(takeoverId: string): void;
  onOpenConversation?(conversationId: string, threadId: string | null): void;
}) {
  const { palette: t } = useTheme();
  const contextLabel = conversationName ? `${assistantName} · ${conversationName}` : assistantName;
  const displayTitle = takeover.title || takeover.url || "Browser takeover";

  return (
    <View
      testID={testID ?? `takeover-card-${takeover.id}`}
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.retroBorder,
        backgroundColor: t.surfaceElevated,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <View
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.badgePink,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text style={type(t.onPink, 10, { fontWeight: "700" })}>Takeover needed</Text>
        </View>
        <View
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.badgeBlue,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text style={type(t.textPrimary, 10, { fontWeight: "700" })}>{contextLabel}</Text>
        </View>
      </View>

      <Text style={type(t.textPrimary, 13, { fontWeight: "700" })}>{displayTitle}</Text>
      <Text style={type(t.textSecondary, 12)}>{takeover.reason}</Text>
      {takeover.url ? (
        <Text numberOfLines={1} style={type(t.textMuted, 11)}>
          {takeover.url}
        </Text>
      ) : null}

      {takeover.screenshotDataUrl ? (
        <Image
          testID={`takeover-thumb-${takeover.id}`}
          source={{ uri: takeover.screenshotDataUrl }}
          style={{
            width: "100%",
            height: 140,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceSecondary,
          }}
          resizeMode="cover"
        />
      ) : null}

      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <ActionButton
          testID={`takeover-open-${takeover.id}`}
          label="Take over browser"
          accent
          disabled={busy}
          onPress={() => onOpenTakeover(takeover)}
        >
          Take over · 我来处理
        </ActionButton>
        <ActionButton
          testID={`takeover-resolve-${takeover.id}`}
          label="Mark takeover done and continue"
          disabled={busy}
          onPress={() => onResolve(takeover.id)}
        >
          Done, continue · 处理完成，继续
        </ActionButton>
        <ActionButton
          testID={`takeover-cancel-${takeover.id}`}
          label="Cancel takeover"
          disabled={busy}
          onPress={() => onCancel(takeover.id)}
        >
          Cancel · 取消
        </ActionButton>
        {onOpenConversation ? (
          <ActionButton
            label="Open chat"
            disabled={busy}
            onPress={() => onOpenConversation(takeover.conversationId, takeover.threadId)}
          >
            Open chat
          </ActionButton>
        ) : null}
      </View>
    </View>
  );
}

export function BrowserTakeoverModal({
  takeover,
  assistantName = "Assistant",
  data,
  onClose,
  onResolved,
}: {
  takeover: Takeover;
  assistantName?: string;
  data: Pick<PavraData, "call">;
  onClose(): void;
  onResolved?(): void;
}) {
  const { palette: t } = useTheme();
  const [snapshot, setSnapshot] = useState<BrowserPageState>({
    active: true,
    url: takeover.url ?? null,
    title: takeover.title ?? null,
    screenshotDataUrl: takeover.screenshotDataUrl ?? null,
    elements: [],
  });
  const [urlDraft, setUrlDraft] = useState(takeover.url ?? "");
  const [urlKey, setUrlKey] = useState(0);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [fillValue, setFillValue] = useState("");
  const [fillKey, setFillKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = useCallback((next: BrowserPageState) => {
    setSnapshot(next);
    if (next.url) {
      setUrlDraft(next.url);
      setUrlKey((value) => value + 1);
    }
    setSelectedRef((current) => {
      if (current && next.elements.some((el: BrowserElement) => el.ref === current)) {
        return current;
      }
      return next.elements[0]?.ref ?? null;
    });
  }, []);

  const refreshState = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await data.call(browserPageState, { assistantId: takeover.assistantId });
      applySnapshot(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot, data, takeover.assistantId]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const performRemoteAction = useCallback(
    async (input: {
      action: "goto" | "click" | "fill" | "press" | "scroll" | "reload";
      url?: string;
      ref?: string;
      x?: number;
      y?: number;
      value?: string;
      key?: string;
      deltaY?: number;
    }) => {
      setBusy(true);
      setError(null);
      try {
        const next = await data.call(browserRemoteAction, {
          assistantId: takeover.assistantId,
          ...input,
        });
        applySnapshot(next);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, data, takeover.assistantId],
  );

  const handleResolve = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await data.call(resolveTakeover, { id: takeover.id });
      onResolved?.();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [data, onClose, onResolved, takeover.id]);

  const handleCancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await data.call(cancelTakeover, { id: takeover.id });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, [data, onClose, takeover.id]);

  const handleFillSubmit = useCallback(() => {
    if (!selectedRef) return;
    void performRemoteAction({ action: "fill", ref: selectedRef, value: fillValue });
    setFillValue("");
    setFillKey((value) => value + 1);
  }, [fillValue, performRemoteAction, selectedRef]);

  return (
    <FormFrame title={`Browser Takeover · ${assistantName}`} onClose={onClose}>
      <View testID="browser-takeover-modal" style={{ gap: 12 }}>
        <View
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceSecondary,
            padding: 10,
            gap: 4,
          }}
        >
          <Text style={type(t.textPrimary, 12, { fontWeight: "700" })}>
            {snapshot.title || takeover.title || "Remote Browser Session"}
          </Text>
          <Text style={type(t.textSecondary, 12)}>{takeover.reason}</Text>
        </View>

        <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <PavraInput
            key={`url:${urlKey}`}
            accessibilityLabel="Browser URL"
            initialValue={urlDraft}
            onChangeText={setUrlDraft}
            editable={!busy}
            placeholder="https://..."
            style={{ flex: 1, minWidth: 180, minHeight: 34 }}
          />
          <ActionButton
            testID="takeover-modal-goto"
            label="Navigate to URL"
            disabled={busy || !urlDraft.trim()}
            onPress={() => void performRemoteAction({ action: "goto", url: urlDraft.trim() })}
          >
            Go
          </ActionButton>
          <ActionButton
            testID="takeover-modal-reload"
            label="Reload page"
            disabled={busy}
            onPress={() => void performRemoteAction({ action: "reload" })}
          >
            Reload
          </ActionButton>
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={type(t.destructive, 12)}>
            {error}
          </Text>
        ) : null}

        {snapshot.screenshotDataUrl ? (
          <Image
            testID="takeover-modal-screenshot"
            source={{ uri: snapshot.screenshotDataUrl }}
            style={{
              width: "100%",
              height: 260,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceSecondary,
            }}
            resizeMode="contain"
          />
        ) : (
          <View
            style={{
              height: 140,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfaceSecondary,
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <Text style={type(t.textMuted, 12)}>
              {busy ? "Loading remote browser preview…" : "No live screenshot available yet."}
            </Text>
          </View>
        )}

        <View style={{ gap: 6 }}>
          <Text style={type(t.textSecondary, 11, { fontWeight: "700" })}>
            Interactive elements ({snapshot.elements.length})
          </Text>
          {snapshot.elements.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {snapshot.elements.slice(0, 24).map((el: BrowserElement) => {
                const selected = selectedRef === el.ref;
                return (
                  <ActionButton
                    key={el.ref}
                    testID={`takeover-element-${el.ref}`}
                    label={`${el.ref} ${el.role} ${el.name}`}
                    accent={selected}
                    disabled={busy}
                    onPress={() => setSelectedRef(el.ref)}
                  >
                    {`${el.ref} ${el.role}${el.name ? `: ${el.name.slice(0, 24)}` : ""}`}
                  </ActionButton>
                );
              })}
            </View>
          ) : (
            <Text style={type(t.textMuted, 11)}>
              Press Reload to inspect interactive elements on the current page.
            </Text>
          )}
        </View>

        <View
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfaceSecondary,
            padding: 10,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <ActionButton
              testID="takeover-modal-click"
              label="Click selected element"
              accent
              disabled={busy || !selectedRef}
              onPress={() => {
                if (selectedRef) {
                  void performRemoteAction({ action: "click", ref: selectedRef });
                }
              }}
            >
              {selectedRef ? `Click ${selectedRef}` : "Select element to click"}
            </ActionButton>
            <ActionButton
              testID="takeover-modal-press-enter"
              label="Press Enter"
              disabled={busy}
              onPress={() => void performRemoteAction({ action: "press", key: "Enter" })}
            >
              Press Enter
            </ActionButton>
            <ActionButton
              testID="takeover-modal-scroll-down"
              label="Scroll down"
              disabled={busy}
              onPress={() => void performRemoteAction({ action: "scroll", deltaY: 420 })}
            >
              Scroll Down
            </ActionButton>
            <ActionButton
              testID="takeover-modal-scroll-up"
              label="Scroll up"
              disabled={busy}
              onPress={() => void performRemoteAction({ action: "scroll", deltaY: -420 })}
            >
              Scroll Up
            </ActionButton>
          </View>

          <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <PavraInput
              key={`fill:${fillKey}`}
              accessibilityLabel="Fill value for selected element"
              initialValue={fillValue}
              onChangeText={setFillValue}
              editable={!busy && Boolean(selectedRef)}
              placeholder={
                selectedRef ? `Type text into ${selectedRef}…` : "Select an element chip above…"
              }
              style={{ flex: 1, minWidth: 180, minHeight: 34 }}
            />
            <ActionButton
              testID="takeover-modal-fill"
              label="Fill selected element"
              disabled={busy || !selectedRef}
              onPress={handleFillSubmit}
            >
              Fill
            </ActionButton>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            paddingTop: 4,
          }}
        >
          <ActionButton
            testID={`takeover-resolve-${takeover.id}`}
            label="Done, continue"
            accent
            disabled={busy}
            onPress={() => void handleResolve()}
          >
            Done, continue · 处理完成，继续
          </ActionButton>
          <ActionButton
            testID={`takeover-cancel-${takeover.id}`}
            label="Cancel takeover"
            disabled={busy}
            onPress={() => void handleCancel()}
          >
            Cancel · 取消
          </ActionButton>
        </View>
      </View>
    </FormFrame>
  );
}
