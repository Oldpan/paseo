// Browser-only document derived from Bigbang's local CodeMirror editor.
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { getLanguageForFile } from "@getpaseo/highlight";
import { editorBaseExtensions, editorTheme, type EditorVisualTheme } from "../extensions.web";
import { MAX_EDITOR_MESSAGE_BYTES } from "./bridge";

declare global {
  interface Window {
    paseoEditorReceive(message: unknown): void;
  }
}
let view: EditorView | null = null;
let sessionId = "";
let revision = 0;
let sourceRevision = 0;
const remote = Annotation.define<boolean>();
const appearance = new Compartment();
const syntax = new Compartment();

function send(type: string, fields: object = {}) {
  const post = window.ReactNativeWebView?.postMessage;
  post?.(JSON.stringify({ type, sessionId, revision, sourceRevision, ...fields }));
}

interface HostMessage {
  type: string;
  sessionId: string;
  content: string;
  basedOnRevision: number;
  sourceRevision: number;
  filename: string;
  theme: EditorVisualTheme;
  lineStart?: number;
  lineEnd?: number;
  command?: string;
}

function initialize(message: HostMessage) {
  if (view || !message.sessionId || typeof message.content !== "string") return;
  sessionId = message.sessionId;
  sourceRevision = message.sourceRevision;
  view = new EditorView({
    parent: document.getElementById("editor")!,
    state: EditorState.create({
      doc: message.content,
      extensions: [
        ...editorBaseExtensions(() => send("save")),
        search(),
        keymap.of(searchKeymap),
        appearance.of(editorTheme(message.theme)),
        syntax.of(getLanguageForFile(message.filename)?.extension ?? []),
        EditorState.transactionFilter.of((transaction) => {
          if (!transaction.docChanged) return transaction;
          const bytes = new TextEncoder().encode(
            JSON.stringify({ content: transaction.newDoc.toString() }),
          ).length;
          if (bytes < MAX_EDITOR_MESSAGE_BYTES - 1024) return transaction;
          queueMicrotask(() => send("error", { message: "The editor buffer exceeds 20 MiB." }));
          return [];
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(remote))) {
            revision++;
            send("change", { content: update.state.doc.toString() });
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            send("state", { line: line.number, column: head - line.from + 1 });
          }
        }),
      ],
    }),
  });
  send("ready");
}

function revealLocation(message: HostMessage) {
  if (!view) return;
  if (message.type === "location" && message.lineStart) {
    const start = view.state.doc.line(
      Math.max(1, Math.min(message.lineStart, view.state.doc.lines)),
    ).from;
    const end = view.state.doc.line(
      Math.max(1, Math.min(message.lineEnd ?? message.lineStart, view.state.doc.lines)),
    ).to;
    view.dispatch({
      selection: { anchor: start, head: message.lineEnd ? Math.max(start, end) : start },
      effects: EditorView.scrollIntoView(start, { y: "center" }),
    });
  }
}

window.paseoEditorReceive = (raw: unknown) => {
  if (!raw || typeof raw !== "object") return;
  const message = raw as HostMessage;
  if (message.type === "init") {
    initialize(message);
    return;
  }
  if (!view || message.sessionId !== sessionId) return;
  if (
    message.type === "buffer" &&
    message.basedOnRevision === revision &&
    typeof message.content === "string"
  ) {
    sourceRevision = message.sourceRevision;
    const doc = view.state.toText(message.content);
    if (!view.state.doc.eq(doc))
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        selection: { anchor: Math.min(view.state.selection.main.head, doc.length) },
        annotations: [remote.of(true), Transaction.addToHistory.of(false)],
      });
  }
  if (message.type === "config") {
    view.dispatch({
      effects: [
        appearance.reconfigure(editorTheme(message.theme)),
        syntax.reconfigure(getLanguageForFile(message.filename)?.extension ?? []),
      ],
    });
    document.body.style.background = message.theme.background;
  }
  if (message.type === "location") revealLocation(message);
  if (message.type === "command") {
    if (message.command === "undo") undo(view);
    if (message.command === "redo") redo(view);
    if (message.command === "search") openSearchPanel(view);
    view.focus();
  }
};
window.addEventListener("resize", () => view?.requestMeasure());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) view?.requestMeasure();
});
