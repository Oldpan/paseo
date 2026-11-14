import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAssistantPlaybook,
  listAssistantPlaybooks,
  readAssistantPlaybook,
  writeAssistantPlaybook,
  type PlaybookSummary,
} from "../../../../extensions/pavra/shared/contracts";
import type { PavraData } from "./data";
import { errorText } from "./memory";

export interface PlaybooksModel {
  playbooks: PlaybookSummary[];
  selectedSlug: string | null;
  content: string;
  editorKey: number;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  select(slug: string): void;
  create(rawSlug: string): void;
  change(text: string): void;
  save(): void;
  remove(slug?: string): void;
  reload(): void;
}

export function normalizePlaybookSlug(rawSlug: string): string {
  return rawSlug
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/g, "");
}

export function titleFromSlug(slug: string): string {
  return (
    slug
      .split(/[-_]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || slug
  );
}

export function playbookTemplate(slug: string): string {
  return `# ${titleFromSlug(slug)}\n\n## Goal\n\n## Steps\n1. \n`;
}

export function isPlaybookConflict(error: unknown): boolean {
  return error instanceof Error && /changed since it was loaded/i.test(error.message);
}

interface LoadedPlaybook {
  slug: string | null;
  content: string;
  mtimeMs: number;
  editorKey: number;
}

const EMPTY_PLAYBOOK: LoadedPlaybook = { slug: null, content: "", mtimeMs: 0, editorKey: 0 };

/** Lists, reads, writes, and deletes an assistant's playbooks (`playbooks/<slug>.md`). */
export function useAssistantPlaybooks(
  data: Pick<PavraData, "invoke" | "connected">,
  assistantId: string | undefined,
): PlaybooksModel {
  const { invoke } = data;
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selectedSlugRef = useRef<string | null>(null);
  selectedSlugRef.current = selectedSlug;
  const [file, setFile] = useState<LoadedPlaybook>(EMPTY_PLAYBOOK);
  const fileRef = useRef(file);
  fileRef.current = file;
  const draft = useRef<string | null>(null);
  const [loading, setLoading] = useState(Boolean(assistantId));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const adopt = useCallback((next: { slug: string | null; content: string; mtimeMs: number }) => {
    draft.current = null;
    setDirty(false);
    setFile((previous) => ({ ...next, editorKey: previous.editorKey + 1 }));
  }, []);

  useEffect(() => {
    if (!assistantId) {
      setPlaybooks([]);
      setSelectedSlug(null);
      adopt({ slug: null, content: "", mtimeMs: 0 });
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const listed = await invoke(listAssistantPlaybooks, { assistantId });
        if (cancelled) return;
        setPlaybooks(listed.playbooks);
        const currentSlug = selectedSlugRef.current;
        const targetSlug =
          currentSlug && listed.playbooks.some((item) => item.slug === currentSlug)
            ? currentSlug
            : (listed.playbooks[0]?.slug ?? null);
        setSelectedSlug(targetSlug);
        if (!targetSlug) {
          adopt({ slug: null, content: "", mtimeMs: 0 });
          return;
        }
        const loaded = await invoke(readAssistantPlaybook, { assistantId, slug: targetSlug });
        if (cancelled) return;
        adopt({ slug: loaded.slug, content: loaded.content, mtimeMs: loaded.mtimeMs });
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
    (slug: string) => {
      if (!assistantId) return;
      setSelectedSlug(slug);
      setError(null);
      const loadOne = async () => {
        setLoading(true);
        try {
          const loaded = await invoke(readAssistantPlaybook, { assistantId, slug });
          adopt({ slug: loaded.slug, content: loaded.content, mtimeMs: loaded.mtimeMs });
        } catch (failure) {
          setError(errorText(failure));
        } finally {
          setLoading(false);
        }
      };
      void loadOne();
    },
    [adopt, assistantId, invoke],
  );

  const create = useCallback(
    (rawSlug: string) => {
      const slug = normalizePlaybookSlug(rawSlug);
      if (!slug) {
        setError("Enter a playbook slug (letters, numbers, and hyphens).");
        return;
      }
      if (playbooks.some((item) => item.slug === slug)) {
        select(slug);
        return;
      }
      const template = playbookTemplate(slug);
      const title = titleFromSlug(slug);
      setPlaybooks((previous) =>
        [...previous.filter((item) => item.slug !== slug), { slug, title, mtimeMs: 0 }].toSorted(
          (a, b) => a.slug.localeCompare(b.slug),
        ),
      );
      setSelectedSlug(slug);
      draft.current = template;
      setDirty(true);
      setError(null);
      setFile((previous) => ({
        slug,
        content: template,
        mtimeMs: 0,
        editorKey: previous.editorKey + 1,
      }));
    },
    [playbooks, select],
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
    const slug = selectedSlugRef.current;
    if (!assistantId || !slug) return;
    const content = draft.current ?? fileRef.current.content;
    const write = async () => {
      setSaving(true);
      setError(null);
      try {
        const result = await invoke(writeAssistantPlaybook, {
          assistantId,
          slug,
          content,
          expectedMtimeMs: fileRef.current.mtimeMs,
        });
        setFile((previous) => ({
          ...previous,
          slug: result.slug,
          content: result.content,
          mtimeMs: result.mtimeMs,
        }));
        setDirty(draft.current !== null && draft.current !== result.content);
        const listed = await invoke(listAssistantPlaybooks, { assistantId });
        setPlaybooks(listed.playbooks);
      } catch (failure) {
        if (isPlaybookConflict(failure)) {
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
    (slug?: string) => {
      const targetSlug = slug ?? selectedSlugRef.current;
      if (!assistantId || !targetSlug) return;
      const runDelete = async () => {
        setSaving(true);
        setError(null);
        try {
          await invoke(deleteAssistantPlaybook, { assistantId, slug: targetSlug });
          if (selectedSlugRef.current === targetSlug) {
            selectedSlugRef.current = null;
            setSelectedSlug(null);
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

  return {
    playbooks,
    selectedSlug,
    content: file.content,
    editorKey: file.editorKey,
    loading,
    saving,
    dirty,
    error,
    select,
    create,
    change,
    save,
    remove,
    reload,
  };
}
