import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteAssistantNote,
  listAssistantNotes,
  readAssistantMemory,
  readAssistantNote,
  writeAssistantMemory,
  writeAssistantNote,
  type AssistantNoteCategory,
  type AssistantNoteSummary,
} from "../../../../extensions/pavra/shared/contracts";
import type { PavraData } from "./data";

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
  data: Pick<PavraData, "invoke" | "connected">,
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

export interface NotesTreeModel {
  notes: AssistantNoteSummary[];
  selectedPath: string;
  selectedNote: AssistantNoteSummary | null;
  content: string;
  mtimeMs: number;
  editorKey: number;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  canDelete: boolean;
  select(path: string): void;
  create(rawInput: string, category?: AssistantNoteCategory): string | null;
  change(text: string): void;
  save(): void;
  remove(path?: string): void;
  reload(): void;
}

export interface NoteCategoryGroup {
  category: AssistantNoteCategory;
  label: string;
  notes: AssistantNoteSummary[];
}

const DEFAULT_NOTES: AssistantNoteSummary[] = [
  {
    path: "MEMORY.md",
    category: "index",
    title: "MEMORY.md",
    mtimeMs: 0,
    sizeBytes: 0,
  },
  {
    path: "notes/user-preferences.md",
    category: "preferences",
    title: "User Preferences",
    mtimeMs: 0,
    sizeBytes: 0,
  },
];

const CATEGORY_ORDER: ReadonlyArray<{
  category: AssistantNoteCategory;
  label: string;
}> = [
  { category: "index", label: "Index (MEMORY.md)" },
  { category: "preferences", label: "User Preferences" },
  { category: "channels", label: "Channel Notes" },
  { category: "work-log", label: "Work Logs" },
  { category: "general", label: "General Notes" },
  { category: "archive", label: "Archive" },
];

const CATEGORY_RANK: Readonly<Record<AssistantNoteCategory, number>> = {
  index: 0,
  preferences: 1,
  channels: 2,
  "work-log": 3,
  general: 4,
  archive: 5,
};

const CREATABLE_SUBDIRS: Readonly<Record<string, AssistantNoteCategory>> = {
  channels: "channels",
  "work-log": "work-log",
  general: "general",
  archive: "archive",
};

export function normalizeNoteSlug(rawSlug: string): string {
  return rawSlug
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 80)
    .replace(/[-_]+$/g, "");
}

export function titleFromNoteSlug(slug: string): string {
  return (
    slug
      .split(/[-_]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || slug
  );
}

export function noteTemplate(slug: string): string {
  return `# ${titleFromNoteSlug(slug)}\n\n`;
}

const CORE_NOTE_LOOKUP: Readonly<
  Record<string, { path: string; category: AssistantNoteCategory; slug: string; title: string }>
> = {
  "memory.md": { path: "MEMORY.md", category: "index", slug: "MEMORY", title: "MEMORY.md" },
  memory: { path: "MEMORY.md", category: "index", slug: "MEMORY", title: "MEMORY.md" },
  "notes/user-preferences.md": {
    path: "notes/user-preferences.md",
    category: "preferences",
    slug: "user-preferences",
    title: "User Preferences",
  },
  "user-preferences.md": {
    path: "notes/user-preferences.md",
    category: "preferences",
    slug: "user-preferences",
    title: "User Preferences",
  },
  "user-preferences": {
    path: "notes/user-preferences.md",
    category: "preferences",
    slug: "user-preferences",
    title: "User Preferences",
  },
};

function resolveSingleNoteSegment(
  rawSegment: string,
  defaultCategory: AssistantNoteCategory,
  hadExplicitNotesPrefix: boolean,
): { path: string; category: AssistantNoteCategory; slug: string; title: string } | null {
  const slug = normalizeNoteSlug(rawSegment);
  if (!slug) return null;
  if (hadExplicitNotesPrefix && defaultCategory === "general") {
    return {
      path: `notes/${slug}.md`,
      category: "general",
      slug,
      title: titleFromNoteSlug(slug),
    };
  }
  const targetCategory = CREATABLE_SUBDIRS[defaultCategory] ?? "general";
  return {
    path: `notes/${targetCategory}/${slug}.md`,
    category: targetCategory,
    slug,
    title: titleFromNoteSlug(slug),
  };
}

export function resolveNewNotePath(
  rawInput: string,
  defaultCategory: AssistantNoteCategory = "general",
): { path: string; category: AssistantNoteCategory; slug: string; title: string } | null {
  const cleaned = rawInput.trim().replace(/^\/+|\/+$/g, "");
  if (!cleaned) return null;

  const coreMatch = CORE_NOTE_LOOKUP[cleaned.toLowerCase()];
  if (coreMatch) return coreMatch;

  const rawParts = cleaned.split("/").filter(Boolean);
  const hadExplicitNotesPrefix = rawParts[0]?.toLowerCase() === "notes";
  const parts = hadExplicitNotesPrefix ? rawParts.slice(1) : rawParts;

  if (parts.length === 2) {
    const matchedCategory = CREATABLE_SUBDIRS[parts[0]!.toLowerCase()];
    const slug = normalizeNoteSlug(parts[1]!);
    if (!matchedCategory || !slug) return null;
    return {
      path: `notes/${matchedCategory}/${slug}.md`,
      category: matchedCategory,
      slug,
      title: titleFromNoteSlug(slug),
    };
  }

  if (parts.length === 1) {
    return resolveSingleNoteSegment(parts[0]!, defaultCategory, hadExplicitNotesPrefix);
  }

  return null;
}

export function ensureCoreNotes(notes: readonly AssistantNoteSummary[]): AssistantNoteSummary[] {
  const byPath = new Map<string, AssistantNoteSummary>();
  for (const item of DEFAULT_NOTES) {
    byPath.set(item.path, item);
  }
  for (const item of notes) {
    byPath.set(item.path, item);
  }
  return [...byPath.values()].sort((a, b) => {
    const rankDiff = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
    if (rankDiff !== 0) return rankDiff;
    return a.path.localeCompare(b.path);
  });
}

export function groupNotesByCategory(
  notes: readonly AssistantNoteSummary[],
): ReadonlyArray<NoteCategoryGroup> {
  const normalized = ensureCoreNotes(notes);
  return CATEGORY_ORDER.map(({ category, label }) => ({
    category,
    label,
    notes: normalized.filter((item) => item.category === category),
  }));
}

interface LoadedNoteFile {
  path: string;
  content: string;
  mtimeMs: number;
  editorKey: number;
}

const EMPTY_NOTE_FILE: LoadedNoteFile = {
  path: "MEMORY.md",
  content: "",
  mtimeMs: 0,
  editorKey: 0,
};

/** Lists, selects, reads, writes, creates, and deletes an assistant's multi-file memory and notes tree. */
export function useAssistantNotesTree(
  data: Pick<PavraData, "invoke" | "connected">,
  assistantId: string | undefined,
): NotesTreeModel {
  const { invoke } = data;
  const [notes, setNotes] = useState<AssistantNoteSummary[]>(DEFAULT_NOTES);
  const [selectedPath, setSelectedPath] = useState<string>("MEMORY.md");
  const selectedPathRef = useRef<string>("MEMORY.md");
  selectedPathRef.current = selectedPath;
  const [file, setFile] = useState<LoadedNoteFile>(EMPTY_NOTE_FILE);
  const fileRef = useRef<LoadedNoteFile>(file);
  fileRef.current = file;
  const draft = useRef<string | null>(null);
  const [loading, setLoading] = useState(Boolean(assistantId));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const adopt = useCallback((next: { path: string; content: string; mtimeMs: number }) => {
    draft.current = null;
    setDirty(false);
    setFile((previous) => ({ ...next, editorKey: previous.editorKey + 1 }));
  }, []);

  useEffect(() => {
    if (!assistantId) {
      setNotes(DEFAULT_NOTES);
      setSelectedPath("MEMORY.md");
      adopt({ path: "MEMORY.md", content: "", mtimeMs: 0 });
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const listed = await invoke(listAssistantNotes, { assistantId });
        if (cancelled) return;
        const mergedNotes = ensureCoreNotes(listed.notes);
        setNotes(mergedNotes);
        const currentPath = selectedPathRef.current || "MEMORY.md";
        const targetPath = mergedNotes.some((item) => item.path === currentPath)
          ? currentPath
          : "MEMORY.md";
        setSelectedPath(targetPath);
        const loaded = await invoke(readAssistantNote, { assistantId, path: targetPath });
        if (cancelled) return;
        adopt({ path: loaded.path, content: loaded.content, mtimeMs: loaded.mtimeMs });
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

  const select = useCallback(
    (path: string) => {
      if (!assistantId) return;
      selectedPathRef.current = path;
      setSelectedPath(path);
      setError(null);
      const loadOne = async () => {
        setLoading(true);
        try {
          const loaded = await invoke(readAssistantNote, { assistantId, path });
          adopt({ path: loaded.path, content: loaded.content, mtimeMs: loaded.mtimeMs });
        } catch (failure) {
          setError(errorText(failure));
        } finally {
          if (!cancelledRef.current) setLoading(false);
        }
      };
      void loadOne();
    },
    [adopt, assistantId, invoke],
  );

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const create = useCallback(
    (rawInput: string, category: AssistantNoteCategory = "general"): string | null => {
      const resolved = resolveNewNotePath(rawInput, category);
      if (!resolved) {
        setError("Enter a valid note name (letters, numbers, and hyphens).");
        return null;
      }
      if (notes.some((item) => item.path === resolved.path)) {
        select(resolved.path);
        return resolved.path;
      }
      const template = noteTemplate(resolved.slug);
      setNotes((previous) =>
        ensureCoreNotes([
          ...previous.filter((item) => item.path !== resolved.path),
          {
            path: resolved.path,
            category: resolved.category,
            title: resolved.title,
            mtimeMs: 0,
            sizeBytes: template.length,
          },
        ]),
      );
      selectedPathRef.current = resolved.path;
      setSelectedPath(resolved.path);
      draft.current = template;
      setDirty(true);
      setError(null);
      setFile((previous) => ({
        path: resolved.path,
        content: template,
        mtimeMs: 0,
        editorKey: previous.editorKey + 1,
      }));
      return resolved.path;
    },
    [notes, select],
  );

  const change = useCallback((text: string) => {
    draft.current = text;
    setDirty(fileRef.current.mtimeMs === 0 || text !== fileRef.current.content);
  }, []);

  const refetch = useCallback(() => setGeneration((value) => value + 1), []);

  const reload = useCallback(() => {
    setError(null);
    refetch();
  }, [refetch]);

  const save = useCallback(() => {
    const path = selectedPathRef.current;
    if (!assistantId || !path) return;
    const content = draft.current ?? fileRef.current.content;
    const write = async () => {
      setSaving(true);
      setError(null);
      try {
        const result = await invoke(writeAssistantNote, {
          assistantId,
          path,
          content,
          expectedMtimeMs: fileRef.current.mtimeMs,
        });
        setFile((previous) => ({
          ...previous,
          path: result.path,
          content: result.content,
          mtimeMs: result.mtimeMs,
        }));
        setDirty(draft.current !== null && draft.current !== result.content);
        const listed = await invoke(listAssistantNotes, { assistantId });
        setNotes(ensureCoreNotes(listed.notes));
      } catch (failure) {
        if (isMemoryConflict(failure)) {
          setError(`${errorText(failure)} The latest version was loaded; your edit was not saved.`);
          refetch();
        } else {
          setError(errorText(failure));
        }
      } finally {
        setSaving(false);
      }
    };
    void write();
  }, [assistantId, invoke, refetch]);

  const remove = useCallback(
    (path?: string) => {
      const targetPath = path ?? selectedPathRef.current;
      if (!assistantId || !targetPath) return;
      if (targetPath === "MEMORY.md") {
        setError("MEMORY.md cannot be deleted.");
        return;
      }
      const runDelete = async () => {
        setSaving(true);
        setError(null);
        try {
          await invoke(deleteAssistantNote, { assistantId, path: targetPath });
          if (selectedPathRef.current === targetPath) {
            selectedPathRef.current = "MEMORY.md";
            setSelectedPath("MEMORY.md");
          }
          refetch();
        } catch (failure) {
          setError(errorText(failure));
        } finally {
          setSaving(false);
        }
      };
      void runDelete();
    },
    [assistantId, invoke, refetch],
  );

  const selectedNote = useMemo(
    () => notes.find((item) => item.path === selectedPath) ?? null,
    [notes, selectedPath],
  );
  const canDelete = selectedPath !== "MEMORY.md";

  return {
    notes,
    selectedPath,
    selectedNote,
    content: file.content,
    mtimeMs: file.mtimeMs,
    editorKey: file.editorKey,
    loading,
    saving,
    dirty,
    error,
    canDelete,
    select,
    create,
    change,
    save,
    remove,
    reload,
  };
}
