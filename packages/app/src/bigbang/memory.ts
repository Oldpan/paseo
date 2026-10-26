import { useCallback, useEffect, useRef, useState } from "react";
import {
  readAssistantMemory,
  writeAssistantMemory,
} from "../../../../extensions/bigbang/shared/contracts";
import type { BigbangData } from "./data";

export interface MemoryModel {
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  /** The file text the editor opens with; `editorKey` changes whenever it is replaced. */
  content: string;
  editorKey: number;
  change(text: string): void;
  save(): void;
  reload(): void;
}

/** The coordinator rejects a write whose `expectedMtimeMs` is stale with this message. */
export function isMemoryConflict(error: unknown): boolean {
  return error instanceof Error && /changed since it was loaded/i.test(error.message);
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface MemoryFile {
  content: string;
  mtimeMs: number;
  editorKey: number;
}
const EMPTY_FILE: MemoryFile = { content: "", mtimeMs: 0, editorKey: 0 };

/** Reads and writes one assistant's MEMORY.md through the coordinator, guarded by its mtime. */
export function useAssistantMemory(
  data: Pick<BigbangData, "invoke" | "connected">,
  assistantId: string | undefined,
): MemoryModel {
  const { invoke } = data;
  const [file, setFile] = useState<MemoryFile>(EMPTY_FILE);
  const [loading, setLoading] = useState(Boolean(assistantId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef(file);
  fileRef.current = file;
  const [generation, setGeneration] = useState(0);

  const adopt = useCallback((next: { content: string; mtimeMs: number }) => {
    draft.current = null;
    setDirty(false);
    setFile((previous) => ({ ...next, editorKey: previous.editorKey + 1 }));
  }, []);

  useEffect(() => {
    if (!assistantId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const result = await invoke(readAssistantMemory, { assistantId });
        if (cancelled) return;
        adopt(result);
      } catch (failure) {
        if (!cancelled) setError(errorText(failure));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [adopt, assistantId, generation, invoke]);

  const change = useCallback((text: string) => {
    draft.current = text;
    setDirty(text !== fileRef.current.content);
  }, []);
  const refetch = useCallback(() => setGeneration((value) => value + 1), []);
  const reload = useCallback(() => {
    setError(null);
    refetch();
  }, [refetch]);
  const save = useCallback(() => {
    if (!assistantId || draft.current === null) return;
    const content = draft.current;
    const write = async () => {
      setSaving(true);
      setError(null);
      try {
        const result = await invoke(writeAssistantMemory, {
          assistantId,
          content,
          expectedMtimeMs: fileRef.current.mtimeMs,
        });
        // Keep the editor mounted: the user may already be typing the next change.
        setFile((previous) => ({ ...previous, content: result.content, mtimeMs: result.mtimeMs }));
        setDirty(draft.current !== null && draft.current !== result.content);
      } catch (failure) {
        if (isMemoryConflict(failure)) {
          setError(`${errorText(failure)} The latest version was loaded; your edit was not saved.`);
          refetch();
        } else setError(errorText(failure));
      } finally {
        setSaving(false);
      }
    };
    void write();
  }, [assistantId, invoke, refetch]);

  return {
    loading,
    saving,
    dirty,
    error,
    content: file.content,
    editorKey: file.editorKey,
    change,
    save,
    reload,
  };
}
