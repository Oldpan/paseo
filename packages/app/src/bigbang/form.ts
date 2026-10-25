export interface FormSnapshot {
  values: Record<string, string>;
  status: "editing" | "submitting" | "saved";
  error: string | null;
}
export function openBigbangForm(
  initial: Record<string, string>,
  submit: (values: Record<string, string>) => Promise<void>,
) {
  let state: FormSnapshot = { values: initial, status: "editing", error: null };
  const listeners = new Set<() => void>();
  const publish = (next: FormSnapshot) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (key: string, value: string) => {
      if (state.status !== "submitting")
        publish({
          values:
            key === "server" && value !== state.values.server
              ? { ...state.values, server: value, provider: "", directory: "" }
              : { ...state.values, [key]: value },
          status: "editing",
          error: null,
        });
    },
    async submit() {
      if (state.status === "submitting") return;
      publish({ ...state, status: "submitting", error: null });
      try {
        await submit(state.values);
        publish({ ...state, status: "saved", error: null });
      } catch (error) {
        publish({
          ...state,
          status: "editing",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
