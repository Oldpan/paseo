import type {
  WebViewErrorEvent,
  ShouldStartLoadRequest,
} from "react-native-webview/lib/WebViewTypes";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { FileEditorModel } from "./model";
import type { EditorVisualTheme } from "./extensions.web";
import html from "./generated/native-editor";
import { allowEditorNavigation, editorScript, parseEditorMessage } from "./native/bridge";

interface FileEditorViewProps {
  model: FileEditorModel;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  vimEnabled: boolean;
  theme: EditorVisualTheme;
  onCursorChange(position: { line: number; column: number }): void;
  onVimModeChange(mode: string | null): void;
  onReady(): void;
}

const TOOLBAR_STYLE = { flexDirection: "row", gap: 16, padding: 8 } as const;
const LOCAL_ORIGINS = ["about:blank"];

export function FileEditorView(props: FileEditorViewProps) {
  const {
    model,
    filename,
    location,
    navigationRevision,
    theme,
    onReady,
    onCursorChange,
    onVimModeChange,
  } = props;
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const sourceRevision = model.getSourceRevision();
  const web = useRef<WebView>(null);
  const session = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const revision = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = useMemo(() => ({ html, baseUrl: "about:blank" }), []);
  const send = useCallback((message: object) => {
    web.current?.injectJavaScript(editorScript({ ...message, sessionId: session.current }));
  }, []);
  const initialize = useCallback(() => {
    revision.current = 0;
    setReady(false);
    send({
      type: "init",
      content: model.getSnapshot().content,
      sourceRevision: model.getSourceRevision(),
      filename,
      theme,
    });
  }, [filename, model, send, theme]);
  const receive = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseEditorMessage(event.nativeEvent.data, session.current, revision.current);
      if (!message) return;
      revision.current = message.revision;
      if (message.type === "ready") {
        setReady(true);
        setError(null);
        onReady();
      }
      if (message.type === "change") {
        const separator = model.getSnapshot().lineSeparator;
        model.edit(message.content!.replace(/\r\n|\r|\n/g, separator), {
          sourceRevision: message.sourceRevision!,
        });
      }
      if (message.type === "save") void model.save();
      if (message.type === "state")
        onCursorChange({ line: message.line!, column: message.column! });
      if (message.type === "error") setError(message.message!);
    },
    [model, onCursorChange, onReady],
  );
  useEffect(() => {
    if (ready)
      send({
        type: "buffer",
        basedOnRevision: revision.current,
        content: model.getSnapshot().content,
        sourceRevision,
      });
  }, [model, ready, send, snapshot.content, sourceRevision]);
  useEffect(() => {
    if (ready) send({ type: "config", filename, theme });
  }, [filename, ready, send, theme]);
  useEffect(() => {
    if (ready) send({ type: "location", lineStart: location.lineStart, lineEnd: location.lineEnd });
  }, [location.lineStart, location.lineEnd, navigationRevision, ready, send]);
  useEffect(() => onVimModeChange(null), [onVimModeChange]);

  const frameStyle = useMemo(
    () => ({ flex: 1, backgroundColor: theme.background }),
    [theme.background],
  );
  const textStyle = useMemo(() => ({ color: theme.foreground }), [theme.foreground]);
  const commands = useMemo(
    () =>
      (["undo", "redo", "search"] as const).map((command) => ({
        command,
        run: () => send({ type: "command", command }),
      })),
    [send],
  );
  const shouldLoad = useCallback(
    (request: ShouldStartLoadRequest) => allowEditorNavigation(request.url),
    [],
  );
  const failed = useCallback(
    (event: WebViewErrorEvent) => setError(event.nativeEvent.description),
    [],
  );
  const terminated = useCallback(() => {
    setError("The editor stopped. Your buffer is kept; reopen the file to continue.");
    setReady(false);
  }, []);

  return (
    <View style={frameStyle} testID="native-file-source-editor">
      <View style={TOOLBAR_STYLE}>
        {commands.map(({ command, run }) => (
          <Button
            key={command}
            accessibilityRole="button"
            accessibilityLabel={command}
            disabled={!ready}
            onPress={run}
          >
            <Text style={textStyle}>{command}</Text>
          </Button>
        ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={textStyle}>
          {error}
        </Text>
      ) : null}
      <WebView
        ref={web}
        source={source}
        style={frameStyle}
        originWhitelist={LOCAL_ORIGINS}
        onShouldStartLoadWithRequest={shouldLoad}
        onMessage={receive}
        onLoadEnd={initialize}
        onError={failed}
        onContentProcessDidTerminate={initialize}
        onRenderProcessGone={terminated}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
}
