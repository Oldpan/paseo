import { isWeb } from "@/constants/platform";
// Migrated from Bigbang apps/app/src/Chat.tsx:Composer. Keep presentation changes reviewable against that source.
import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { Platform, ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { PaperclipIcon, SendIcon, StopIcon } from "./icons";
import { bubbleShadow, ctrlShadow, text as type, webTransition } from "./theme";
import { useTheme } from "./ThemeProvider";
import {
  resolveSlashCommands,
  findMatchingSlashCommands,
  parseSlashInvocation,
  replaceLeadingSlashCommand,
  buildPromptSlashCommand,
} from "./slashCommands";
interface PendingAttachment {
  localId: string;
  attachmentId: string | null;
  name: string;
  previewUrl: string | null;
}

export function Composer({
  draft,
  setDraft,
  failed,
  showCancel,
  cancelling,
  phone,
  connected,
  pendingFiles,
  uploading,
  uploadError,
  allowPlanMode,
  showSendAsTask,
  draftKey,
  agentType,
  footerAction,
  onAttach,
  onRemovePending,
  onSend,
  onStop,
}: {
  draft: string;
  setDraft: (value: string) => void;
  failed: boolean;
  showCancel: boolean;
  cancelling: boolean;
  phone: boolean;
  connected: boolean;
  pendingFiles: PendingAttachment[];
  uploading: boolean;
  uploadError: string;
  allowPlanMode: boolean;
  showSendAsTask: boolean;
  draftKey: string;
  agentType?: string;
  footerAction?: ReactNode;
  onAttach?: () => void;
  onRemovePending: (localId: string) => void;
  onPasteFiles: (files: File[]) => void;
  onSend: (extras?: {
    sendAsTask?: boolean;
    planMode?: boolean;
    slashCommand?: { name: string; bodyText: string };
  }) => void;
  onStop: () => void;
}) {
  const { palette: t, name } = useTheme();
  const editor = useRef<EditingTextInputHandle>(null);
  useEffect(() => {
    if (editor.current && editor.current.getText() !== draft) editor.current.replaceText(draft);
  }, [draft]);
  const [planMode, setPlanMode] = useState(false);
  const [sendAsTask, setSendAsTask] = useState(false);
  const [userRows, setUserRows] = useState<number | null>(null);
  const userRowsRef = useRef<number | null>(null);
  const inputLayoutH = useRef(0);
  const resizing = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartRows = useRef(1);
  const line = 20;
  const minHeight = phone ? 40 : 36;
  const padV = isWeb ? (phone ? 10 : 8) : phone ? 6 : 4;
  const autoMaxHeight = line * 3 + padV * 2;
  const [autoH, setAutoH] = useState(minHeight);
  const inputHeight = userRows != null ? Math.max(minHeight, userRows * line + padV * 2) : autoH;
  const locked = failed;
  const sendLocked = locked || uploading;
  const emptyDraft = !draft.trim() && pendingFiles.every((item) => !item.attachmentId);
  const disabled = sendLocked || (sendAsTask && !draft.trim());
  const slashCommands = useMemo(() => resolveSlashCommands("primary_dm", agentType), [agentType]);
  const slashMatches = useMemo(
    () => findMatchingSlashCommands(draft, slashCommands),
    [draft, slashCommands],
  );
  const [slashIndex, setSlashIndex] = useState(0);
  useEffect(() => {
    setSlashIndex(0);
  }, [draft]);

  useEffect(() => {
    setPlanMode(false);
    setSendAsTask(false);
    setUserRows(null);
    userRowsRef.current = null;
    setAutoH(minHeight);
  }, [draftKey, minHeight]);
  useEffect(() => {
    if (!allowPlanMode) setPlanMode(false);
  }, [allowPlanMode]);
  useEffect(() => {
    if (!showSendAsTask) setSendAsTask(false);
  }, [showSendAsTask]);
  useEffect(() => {
    if (userRows != null) return;
    if (!isWeb) return;
    const frame = requestAnimationFrame(() => {
      const el =
        typeof document === "undefined"
          ? null
          : document.querySelector("[data-testid='chat-composer'] [aria-label='Message']");
      if (!(el instanceof HTMLTextAreaElement)) return;
      const previous = el.style.height;
      el.style.height = "auto";
      const scroll = el.scrollHeight;
      el.style.height = previous;
      const next = draft ? Math.min(Math.max(scroll, minHeight), autoMaxHeight) : minHeight;
      setAutoH((current) => (current === next ? current : next));
    });
    return () => cancelAnimationFrame(frame);
  }, [autoMaxHeight, draft, minHeight, userRows]);
  useEffect(() => {
    if (!isWeb) return;
    const onDown = (event: Event) => {
      const mouse = event as Event & { clientY?: number; target?: EventTarget | null };
      const target = mouse.target as { closest?: (selector: string) => unknown } | null;
      if (!target?.closest?.("[data-testid='composer-resize-bar']")) return;
      event.preventDefault();
      const input =
        typeof document === "undefined"
          ? null
          : document.querySelector("[data-testid='chat-composer'] [aria-label='Message']");
      const currentH =
        input instanceof HTMLElement
          ? input.getBoundingClientRect().height
          : inputLayoutH.current || minHeight;
      const currentRows =
        userRowsRef.current ?? Math.max(1, Math.min(10, Math.round((currentH - padV * 2) / line)));
      resizeStartY.current = mouse.clientY ?? 0;
      resizeStartRows.current = currentRows;
      resizing.current = true;
    };
    const onMove = (event: Event) => {
      if (!resizing.current) return;
      const clientY = (event as Event & { clientY?: number }).clientY ?? 0;
      const next = Math.max(
        1,
        Math.min(
          10,
          resizeStartRows.current + Math.round(-(clientY - resizeStartY.current) / line),
        ),
      );
      userRowsRef.current = next;
      setUserRows(next);
    };
    const onUp = () => {
      resizing.current = false;
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [line, minHeight, padV]);

  function submit() {
    if (sendLocked) return;
    if (emptyDraft) return;
    if (sendAsTask && !draft.trim()) return;
    const invocation = parseSlashInvocation(draft, slashCommands);
    if (invocation && !/\s/.test(draft.trim().slice(1)) && slashMatches.length) {
      setDraft(
        replaceLeadingSlashCommand(draft, (slashMatches[slashIndex] ?? slashMatches[0]!).name),
      );
      return;
    }
    const extras = {
      sendAsTask: sendAsTask || undefined,
      planMode: planMode || undefined,
      slashCommand:
        invocation && invocation.command.enabled && invocation.bodyText
          ? buildPromptSlashCommand(invocation)
          : undefined,
    };
    setPlanMode(false);
    setSendAsTask(false);
    setUserRows(null);
    userRowsRef.current = null;
    setAutoH(minHeight);
    onSend(extras);
  }

  return (
    <View
      testID="chat-composer"
      style={{
        zIndex: 20,
        elevation: 20,
        position: "relative",
        backgroundColor: t.surfaceTertiary,
        paddingHorizontal: phone ? 12 : 16,
        paddingTop: 4,
        paddingBottom: Platform.OS === "ios" ? 8 : 4,
        borderTopWidth: 2,
        borderTopColor: t.retroBorder,
      }}
    >
      {pendingFiles.length ? (
        <View
          testID="pending-attachments"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}
        >
          {pendingFiles.map((item) => (
            <View
              key={item.localId}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                borderWidth: 1,
                borderColor: t.retroBorder,
                borderRadius: 10,
                padding: 6,
                backgroundColor: t.surfacePrimary,
              }}
            >
              {item.previewUrl ? (
                <Image
                  source={{ uri: item.previewUrl }}
                  style={{ width: 28, height: 28, borderRadius: 6 }}
                />
              ) : null}
              <Text numberOfLines={1} style={type(t.textPrimary, 11)}>
                {item.name}
              </Text>
              {item.attachmentId ? null : uploading ? (
                <ActivityIndicator size={10} color={t.textMuted} />
              ) : null}
              <Pressable
                accessibilityLabel="Remove attachment"
                onPress={() => onRemovePending(item.localId)}
              >
                <Text style={type(t.textMuted, 11)}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {uploadError ? (
        <Text
          role="alert"
          testID="upload-error"
          style={type(t.destructive, 12, { marginBottom: 6 })}
        >{`Upload failed: ${uploadError}`}</Text>
      ) : null}
      <View
        testID="composer-input-shell"
        style={[
          {
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.retroBorder,
            backgroundColor: t.surfacePrimary,
            overflow: "hidden",
          },
          bubbleShadow(t, name),
        ]}
      >
        <View
          testID="composer-resize-bar"
          accessibilityLabel="Resize message box"
          style={{ height: 4, alignItems: "center", justifyContent: "center" }}
        >
          <View
            style={{ height: 2, width: 32, borderRadius: 999, backgroundColor: t.retroBorderLight }}
          />
        </View>
        <View style={{ paddingHorizontal: 6, paddingBottom: isWeb ? 4 : 6 }}>
          <EditingTextInput
            ref={editor}
            accessibilityLabel="Message"
            placeholder={
              connected ? "Send a message..." : "Connection is reconnecting... You can still type."
            }
            placeholderTextColor={t.textSubtle}
            multiline
            {...(isWeb ? { numberOfLines: userRows ?? 1 } : {})}
            initialValue={draft}
            onChangeText={setDraft}
            editable={!locked}
            accessibilityState={{ disabled: locked }}
            onLayout={(event) => {
              inputLayoutH.current = event.nativeEvent.layout.height;
            }}
            onContentSizeChange={(event) => {
              if (userRowsRef.current != null || isWeb) return;
              const scroll = event.nativeEvent.contentSize.height;
              const next = draft ? Math.min(Math.max(scroll, minHeight), autoMaxHeight) : minHeight;
              setAutoH((current) => (current === next ? current : next));
            }}
            style={[
              type(t.textPrimary, phone ? 16 : 14, {
                lineHeight: line,
                paddingHorizontal: 10,
                paddingVertical: padV,
                minHeight,
                height: inputHeight,
                maxHeight: userRows != null ? inputHeight : autoMaxHeight,
                borderRadius: 10,
              }),
              isWeb
                ? ({ overflowY: draft && autoH >= autoMaxHeight - 1 ? "auto" : "hidden" } as object)
                : null,
            ]}
            onKeyPress={(event) => {
              const key = event.nativeEvent as typeof event.nativeEvent & {
                metaKey?: boolean;
                ctrlKey?: boolean;
                shiftKey?: boolean;
              };
              if (slashMatches.length) {
                if (key.key === "ArrowDown") {
                  event.preventDefault();
                  setSlashIndex((current) => (current + 1) % slashMatches.length);
                  return;
                }
                if (key.key === "ArrowUp") {
                  event.preventDefault();
                  setSlashIndex(
                    (current) => (current - 1 + slashMatches.length) % slashMatches.length,
                  );
                  return;
                }
                if (key.key === "Enter" && !key.shiftKey && !key.metaKey && !key.ctrlKey) {
                  event.preventDefault();
                  setDraft(
                    replaceLeadingSlashCommand(
                      draft,
                      (slashMatches[slashIndex] ?? slashMatches[0]!).name,
                    ),
                  );
                  return;
                }
              }
              if (isWeb && key.key === "Enter" && (key.metaKey || key.ctrlKey || key.shiftKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </View>
      </View>
      {slashMatches.length ? (
        <View
          testID="slash-command-palette"
          style={[
            {
              position: "absolute",
              left: phone ? 12 : 16,
              right: phone ? 12 : 16,
              bottom: "100%",
              marginBottom: 4,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.retroBorder,
              backgroundColor: t.surfacePrimary,
              overflow: "hidden",
              zIndex: 40,
            },
            bubbleShadow(t, name),
          ]}
        >
          <View
            style={{
              borderBottomWidth: 1,
              borderBottomColor: t.dividerLine,
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <Text style={type(t.textMuted, 10, { letterSpacing: 1.4, textTransform: "uppercase" })}>
              Slash Commands
            </Text>
          </View>
          {slashMatches.map((command, index) => (
            <Pressable
              key={command.name}
              testID={`slash-command-row-${command.name}`}
              disabled={!command.enabled}
              onPress={() => setDraft(replaceLeadingSlashCommand(draft, command.name))}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                backgroundColor: index === slashIndex ? t.brandAccentMuted : "transparent",
                opacity: command.enabled ? 1 : 0.6,
              }}
            >
              <Text
                style={type(t.textPrimary, 13, { fontFamily: "monospace" })}
              >{`/${command.name}`}</Text>
              <Text numberOfLines={1} style={type(t.textMuted, 10)}>
                {command.enabled ? command.description : command.disabledReason}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
          flexWrap: "wrap",
        }}
      >
        {onAttach ? (
          <Pressable
            testID="attach-file"
            role="button"
            accessibilityLabel="Attach file"
            disabled={locked || uploading}
            onPress={onAttach}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              return [
                {
                  width: phone ? 36 : 26,
                  height: phone ? 36 : 26,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor:
                    hovered && !locked && !uploading ? t.surfaceHover : t.surfaceElevated,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: locked || uploading ? 0.45 : 1,
                  transform: [{ translateY: hovered && !locked && !uploading ? -2 : 0 }],
                  ...webTransition(
                    "transform 100ms cubic-bezier(0.4,0,0.2,1), background-color 100ms",
                  ),
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <PaperclipIcon color={t.textPrimary} size={phone ? 16 : 12} />
          </Pressable>
        ) : (
          footerAction
        )}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {allowPlanMode ? (
            <Pressable
              testID="composer-plan"
              role="button"
              accessibilityLabel="Send next message in plan mode"
              accessibilityState={{ selected: planMode }}
              disabled={locked || uploading}
              onPress={() => setPlanMode((value) => !value)}
              {...(isWeb
                ? ({
                    "aria-pressed": planMode,
                    title: planMode
                      ? "Next send will request a plan"
                      : "Send next message in plan mode",
                  } as object)
                : {})}
              style={(state) => [
                {
                  minHeight: phone ? 36 : 28,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: planMode ? t.brandAccentMuted : t.surfaceElevated,
                  paddingHorizontal: 12,
                  justifyContent: "center",
                  opacity: locked || uploading ? 0.45 : 1,
                  transform: [
                    {
                      translateY:
                        !locked && !uploading && Boolean((state as { hovered?: boolean }).hovered)
                          ? -1
                          : 0,
                    },
                  ],
                },
                ctrlShadow(t, name),
              ]}
            >
              <Text
                style={type(planMode ? t.textPrimary : t.textSecondary, phone ? 12 : 11, {
                  fontWeight: "600",
                })}
              >
                Plan
              </Text>
            </Pressable>
          ) : null}
          {showSendAsTask ? (
            <Pressable
              testID="composer-as-task"
              role="button"
              accessibilityLabel="Send next message as a task"
              accessibilityState={{ selected: sendAsTask }}
              disabled={locked || uploading}
              onPress={() => setSendAsTask((value) => !value)}
              {...(isWeb
                ? ({
                    "aria-pressed": sendAsTask,
                    title: sendAsTask
                      ? "Next send will create a task"
                      : "Send next message as a task",
                  } as object)
                : {})}
              style={(state) => [
                {
                  minHeight: phone ? 36 : 28,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: sendAsTask ? t.success : t.surfaceElevated,
                  paddingHorizontal: 12,
                  justifyContent: "center",
                  opacity: locked || uploading ? 0.45 : 1,
                  transform: [
                    {
                      translateY:
                        !locked && !uploading && Boolean((state as { hovered?: boolean }).hovered)
                          ? -1
                          : 0,
                    },
                  ],
                },
                ctrlShadow(t, name),
              ]}
            >
              <Text
                style={type(sendAsTask ? t.textPrimary : t.textSecondary, phone ? 12 : 11, {
                  fontWeight: "600",
                })}
              >
                As Task
              </Text>
            </Pressable>
          ) : null}
          {showCancel ? (
            <Pressable
              role="button"
              accessibilityLabel="Cancel"
              disabled={cancelling}
              onPress={onStop}
              style={[
                {
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.surfaceElevated,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: cancelling ? 0.6 : 1,
                },
                ctrlShadow(t, name),
              ]}
            >
              {cancelling ? (
                <ActivityIndicator size={12} color={t.textPrimary} />
              ) : (
                <StopIcon color={t.textPrimary} size={14} />
              )}
            </Pressable>
          ) : null}
          <Pressable
            role="button"
            accessibilityLabel="Send"
            disabled={disabled}
            onPress={submit}
            style={(state) => {
              const hovered = Boolean((state as { hovered?: boolean }).hovered);
              const live = !disabled;
              return [
                {
                  minHeight: 36,
                  height: 36,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: t.retroBorder,
                  backgroundColor: t.badgePink,
                  paddingHorizontal: phone ? 16 : 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  opacity: disabled ? 0.45 : 1,
                  transform: [{ translateY: live && hovered && !state.pressed ? -2 : 0 }],
                  ...(isWeb
                    ? ({
                        transition: "transform 100ms cubic-bezier(0.4,0,0.2,1), filter 100ms",
                        filter: live && hovered ? "brightness(1.05)" : undefined,
                      } as object)
                    : null),
                },
                ctrlShadow(t, name),
              ];
            }}
          >
            <Text style={type(t.onPink, phone ? 12 : 11, { fontWeight: "700" })}>Send</Text>
            <SendIcon color={t.onPink} size={phone ? 14 : 16} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
