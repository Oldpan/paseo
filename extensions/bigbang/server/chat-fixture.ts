import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Conversation, Message, Turn } from "../shared/contracts";
import { ChatStore } from "./store";
import type { MachinePort } from "./machines";
import { Coordinator } from "./coordinator";
import { FakeExecution } from "./execution.fake";
import type { TaskLimits } from "../shared/settings";

// A group chat of assistants on a real SQLite file, the in-memory execution and a manual clock.
const cleanup: Array<() => void | Promise<void>> = [];
export async function closeFixtures(): Promise<void> {
  for (const close of cleanup.splice(0).toReversed()) await close();
}
export const HOUR = 60 * 60 * 1000;

export function fixture(
  options: {
    names?: string[];
    sweepMs?: number;
    directory?: string;
    limits?: TaskLimits;
    machines?: MachinePort;
  } = {},
) {
  const directory = options.directory ?? mkdtempSync(path.join(tmpdir(), "bigbang-fanout-"));
  if (!options.directory) cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const clock = { t: 1_800_000_000_000 };
  const execution = new FakeExecution();
  function open(file: string) {
    const store = new ChatStore(file);
    cleanup.push(() => {
      try {
        store.close();
      } catch {
        // Closed by restart().
      }
    });
    const coordinator = new Coordinator(store, directory, {
      execution,
      now: () => clock.t,
      sweepMs: options.sweepMs ?? 1e9,
      ...(options.limits ? { limits: options.limits } : {}),
      ...(options.machines ? { machines: options.machines } : {}),
    });
    cleanup.push(() => coordinator.close());
    coordinator.attach();
    return { store, coordinator };
  }
  const file = path.join(directory, "chat.sqlite");
  let { store, coordinator } = open(file);
  const assistants = (options.names ?? ["Ada", "Bob", "Cy"]).map((name) =>
    coordinator.saveAssistant({
      id: randomUUID(),
      name,
      provider: "codex/test-model",
      persona: "Think carefully",
    }),
  );
  const [ada, bob, cy] = assistants;
  const group = (extra: Partial<Conversation> = {}) =>
    coordinator.createConversation({
      id: randomUUID(),
      name: "Room",
      kind: "group",
      members: assistants.map((assistant) => assistant.id),
      roundtable: false,
      ...extra,
    });
  const conversation = group();
  const nameOf = (id: string) => assistants.find((assistant) => assistant.id === id)?.name ?? id;
  async function say(
    content: string,
    extra: {
      quoteOf?: string;
      conversationId?: string;
      threadId?: string | null;
      responseMode?: "roundtable";
    } = {},
  ) {
    const id = randomUUID();
    coordinator.send({
      id,
      conversationId: extra.conversationId ?? conversation.id,
      threadId: extra.threadId ?? null,
      content,
      ...(extra.quoteOf ? { quoteOf: extra.quoteOf } : {}),
      ...(extra.responseMode ? { responseMode: extra.responseMode } : {}),
    });
    await coordinator.idle();
    return id;
  }
  const turnsOf = (triggerId: string) =>
    store.snapshot().turns.filter((turn) => turn.triggerId === triggerId);
  // Sorted: a turn's row moves in the snapshot when it is updated, so the order is not creation order.
  const kinds = (triggerId: string) =>
    turnsOf(triggerId)
      .map((turn) => `${turn.kind}:${nameOf(turn.assistantId)}`)
      .toSorted();
  /** The turn the lane is running now: explicit targets are dispatched before recent-only ones. */
  const running = () =>
    store.snapshot().turns.find((turn) => turn.accepted && turn.status === "running");
  const ended = (agentId: string) =>
    coordinator.onTurnEnded({ agent: { id: agentId }, outcome: { kind: "completed" } });
  /** Answers every dispatched turn in turn until the lane is idle; unlisted assistants pass. */
  async function run(
    answer: Record<string, string> | ((turn: Turn, name: string) => string) = {},
    before: (turn: Turn) => void = () => undefined,
  ) {
    for (let step = 0; step < 40; step++) {
      const turn = store
        .snapshot()
        .turns.find((item) => item.accepted && item.status === "running");
      if (!turn) return;
      before(turn);
      const name = nameOf(turn.assistantId);
      const text = typeof answer === "function" ? answer(turn, name) : (answer[name] ?? "(pass)");
      execution.say(turn.agentId, text, `m-${turn.id}`);
      execution.finish(turn.agentId);
      ended(turn.agentId);
      await coordinator.idle();
    }
    throw new Error("The lane never went idle.");
  }
  const finals = (): Message[] =>
    store.snapshot().messages.filter((message) => message.kind === "final");
  const sentTo = (turn: Turn) => execution.sent.find((item) => item.messageId === turn.id)!.text;
  /** Opens a second process on the same files; the execution (the daemon) survives. */
  async function restart() {
    await coordinator.close();
    store.close();
    ({ store, coordinator } = open(file));
    return { store, coordinator };
  }
  return {
    directory,
    clock,
    execution,
    assistants,
    ada,
    bob,
    cy,
    conversation,
    group,
    say,
    run,
    turnsOf,
    kinds,
    finals,
    sentTo,
    nameOf,
    running,
    restart,
    get store() {
      return store;
    },
    get coordinator() {
      return coordinator;
    },
  };
}
