import type { Assistant, Conversation, Turn } from "../shared/contracts";
import type { Epoch } from "./roundtable";
import { ROUNDTABLE_MAX_ROUNDS } from "./roundtable";

export const PASS_REPLY = "(pass)";
const at = (assistant: Assistant) => `@${assistant.name}`;

/** Opens the prompt of a turn that reports a finished task; the outcome follows as a bracketed line. */
export const TASK_RECEIPT_LEAD = `A task you started has ended; its outcome is in brackets below. Tell the user what happened in your own words, with what matters to them and what you suggest next. Reply exactly ${PASS_REPLY} only if the user has already seen everything.`;

function reasonLine(turn: Turn, wokenBy: Assistant | undefined): string {
  switch (turn.kind) {
    case "awareness":
      return `You were not addressed directly; you were recently active here. Reply exactly ${PASS_REPLY} unless you have something useful to add.`;
    case "mention":
      return `${wokenBy ? at(wokenBy) : "Another member"} mentioned you. Reply to them, or reply exactly ${PASS_REPLY} if you have nothing useful to add.`;
    case "peer_inbox": {
      const count = turn.inboxMessageIds?.length ?? 0;
      return `You were not addressed in ${count === 1 ? "a message" : `${count} messages`} from other members, listed below. Reply only if you have something useful to add; otherwise reply exactly ${PASS_REPLY}.`;
    }
    case "task_receipt":
      return TASK_RECEIPT_LEAD;
    default:
      return "The user addressed you. Reply to their latest message.";
  }
}

/** What a group turn's prompt says before the new messages: who is here, how to mention, why this turn. */
export function groupPreamble(params: {
  turn: Turn;
  assistant: Assistant;
  conversation: Conversation;
  assistants: Assistant[];
  epoch?: Epoch | null;
}): string {
  const { turn, assistant, conversation, assistants, epoch } = params;
  const members = conversation.members
    .map((id) => assistants.find((item) => item.id === id))
    .filter((item): item is Assistant => Boolean(item));
  if (turn.kind === "roundtable") {
    const speakers = (epoch?.members ?? conversation.members)
      .map((id) => assistants.find((item) => item.id === id))
      .filter((item): item is Assistant => Boolean(item));
    return [
      `You are in a roundtable discussion with ${speakers.map(at).join(", ")}. This is round ${(turn.round ?? 0) + 1} of ${ROUNDTABLE_MAX_ROUNDS}, and it is your turn, ${at(assistant)}.`,
      `Contribute something useful, or reply exactly ${PASS_REPLY} if you have nothing to add. Mention a member with @Name to ask them to speak next round. Do not invite anyone outside these members.`,
    ].join("\n");
  }
  const wokenBy = turn.wokenBy ? assistants.find((item) => item.id === turn.wokenBy) : undefined;
  const who = members.map((item) => (item.id === assistant.id ? `${at(item)} (you)` : at(item)));
  return [
    `Group chat "${conversation.name}" with the user and ${who.join(", ")}. The user appears as "You".`,
    "Mention a member with @Name only when you need their reply; nothing else wakes them.",
    reasonLine(turn, wokenBy),
  ].join("\n");
}
