# Bigbang Chat coordination

How the Bigbang Chat plugin (`extensions/bigbang`) runs chat on Paseo executions. Product decisions and delivery order live in the [Bigbang roadmap](bigbang-roadmap.md), dated evidence in the [acceptance log](bigbang-acceptance.md); local setup and the Mac + Spark workflow live in [Bigbang development](bigbang-development.md).

## Ownership

The coordinator's SQLite ledger (`$PASEO_HOME/bigbang/chat.sqlite`) owns chat: assistants, chats, messages, turns, tasks, roundtable epochs, mention cooldowns, the Peer Inbox, the mailbox and Studio records. Paseo agents only execute. Never infer chat state from an agent's title, labels or free text.

| Chat identity                         | Execution                                                             |
| ------------------------------------- | --------------------------------------------------------------------- |
| One chat + thread + assistant         | One durable Paseo agent, created once and continued; never replaced   |
| One assistant                         | One background workspace on its machine, holding its memory files     |
| One assistant's mailbox               | Its private lane `mailbox:<assistantId>`, another durable agent there |
| One task (user- or assistant-started) | Its own workspace and agent on the chosen host, visible in Studio     |
| One Studio                            | Bound workspaces on any machines; the agents in them are its members  |

## Machines

Every Bigbang daemon runs the same plugin. Its host setting `role` picks the part: `coordinator` (the default) opens the ledger; `member` keeps no ledger and serves one `coordinatorServerId`. A role change applies when the plugin reloads.

An assistant is bound to a machine when it is created and never moves: its home, `MEMORY.md` and chat executions live there, and its turns carry that `serverId`. The machine picker lists the coordinator and its live members (`chat.machines`). The coordinator cannot write files on another host, so a member creates the home and serves memory reads and writes (`member.home.prepare`, `member.memory.*`).

A member's agents call the same `bigbang-*` tools, and its lifecycle hooks still fire only on its own daemon. Both wait in the member's relay until the coordinator long-polls it (`member.poll`) over the host link the coordinator saved; results go back with `member.respond`. The coordinator dials the member, so no reverse link is needed and a relayed call's machine is the link's, not a claim ([SECURITY.md](../SECURITY.md#agent-mcp-identity)). A member answers a call after 25 seconds without a result as unknown and withdraws it, within the daemon's 30-second tool timeout.

Chat executions live in background workspaces so they stay out of the Studio sidebar. A host without `features.backgroundWorkspaces` cannot host a chat execution; update it rather than adding a fallback.

## A turn

1. Persist the turn as prepared, then send only the messages that execution has not seen, with `messageId` set to the turn id. Native history already holds earlier turns; replaying the chat creates conflicting histories.
2. The `user_message` whose `messageId` equals the turn id anchors the turn in the execution's timeline. Recovery after a crash looks for that anchor: present means accepted, absent means send the same message again.
3. When the turn ends, read the anchored slice of the timeline and commit its final assistant text as `final:<turnId>`. Do not use `waitForFinish().lastMessage`: it has no anchor and races with the next turn or with input typed in Studio. Codex starts a new assistant item with `\n\n---\n\n`; the final answer is the last item, with that marker removed.
4. A reply of exactly `(pass)` commits nothing. Silence is a valid answer for awareness, mention, Peer Inbox and roundtable turns.

The final answer is the chat message. There is no send tool and no repair turn: Paseo's timeline already gives a reliable reply and live streaming.

## Events and recovery

Plugin lifecycle hooks (`agent.turn_ended`, `agent.permission_*`, `agent.closed`, `agent.archived`, `agent.created`) drive executions. They are best-effort, unreplayed and fire only on the daemon that runs the agent; members forward theirs over the relay. Each hook only enqueues work; every settle re-reads the timeline, so a duplicated or missed hook converges. A member whose link drops or whose plugin restarts triggers a full sweep. Tasks on hosts without the member plugin are observed through agent subscriptions on `hosts.client(serverId)`. A 60-second sweep and startup recovery through `server.paseo` cover what hooks miss.

An execution that closes mid-turn fails that turn with an "Interrupted" error and keeps the same agent; the next message resumes it. Never guess a reply from partial output.

A daemon restart loses the anchors: Paseo keeps timelines in memory and rebuilds them from provider history, which has no `messageId`. An accepted turn or task whose anchor is gone therefore fails as interrupted once its execution is idle. The cost is that a turn that finished just before the restart, with its hook missed, also fails as interrupted, and a turn prepared but not yet confirmed is sent again.

## Clients

Plugins cannot push to clients, so `chat.state` is a cursor long-poll: it holds a request with `waitMs` until the ledger moves. Keep `waitMs` at 20 seconds or less; plugin requests time out at 30.

The client streams a live reply by reading the bound execution's timeline from the session store of the turn's machine: it registers the agent with `viewedTimelineSync.replaceVisibleAgentIds` and renders the text after the turn's anchor. The bubble gives way to the committed final. Pending approvals render inline with Paseo's `PermissionRequestCard`. A remote assistant's live reply needs the app to reach that machine.

Mailbox rows and Studio records are projected into the synced `peerMessages` collection, Studios into `studios`. A chat lane shows its open peer requests; Studio's Collaboration panel shows a group's Studio and its Records. A Studio collaborates for the tab group with its name.

## Group chats

Routing follows the original Bigbang free-collaboration rules (`shared/routing-preview.ts` is shared with the composer hint):

| Message                        | Who is woken                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| User names members             | Those members, plus recent participants as awareness turns                             |
| User quotes an assistant reply | That assistant, plus recent participants                                               |
| Plain user message             | Recent participants, each with a reply turn (final in this lane within 1 hour, max 20) |
| Nobody recent                  | The default responder, else the first member                                           |
| Assistant final names a member | That member, 60-second cooldown per direction                                          |
| Assistant final names nobody   | Peer Inbox of recent participants, batched at 5 items or 60 seconds                    |

Each assistant gets at most one turn per user message. Assistants woken by the same user message never wake each other with that reply, and a user message allows at most 8 assistant-triggered turns. These limits stop two models from talking forever.

A roundtable starts only from an explicit request on a root message that names 2–6 members. It runs in that message's thread, one speaker at a time, and ends after 3 rounds, 10 visible messages, or a round in which everyone passed. A user reply in the thread starts a new epoch and cancels the speaker in progress.

## Tasks

Assistants start tasks through plugin agent tools (`bigbang-start_task`, `bigbang-task_status`). The daemon binds the caller with a per-agent token ([plugin agent tools](plugins.md#agent-tools), [SECURITY.md](../SECURITY.md)). The plugin authorizes every call from its own ledger: the caller's chat session on the caller's machine, current membership, the assistant's autonomy setting and authorized targets, and a live reply turn. Labels and tool input never authorize.

- Every agent on a Bigbang daemon lists the tools (audience `all`), and each call is authorized as above. Codex lists MCP tools once per session, and Grok connects MCP only when a session is created, never when Paseo loads it again, so any narrower audience hides the tools from a session that started before it was needed.
- Targets record the machine's name when saved, so "start it on Spark" resolves to a `serverId`.
- A worktree task's first prompt says to work only inside its worktree. Briefs written in chat name the source checkout by absolute path, and a worker otherwise edits that checkout.
- Limits are plugin settings: parallel tasks (2), work agents per task (3, enforced by cancelling extras after the fact) and budget minutes (30). Over-limit tasks queue; an expired budget stops the run until the user replies in the task thread.

A task's root message opens its thread; results and follow-ups land there, and a follow-up continues the same executor. The requesting chat receives idempotent lifecycle rows. An assistant that started a task gets one receipt turn to report back.

## Mailbox

An assistant asks another privately with `bigbang-send` (ported from Bigbang Core's Direct Agent Mailbox). The request becomes a turn in the recipient's mailbox lane, on the recipient's machine, and that turn's final answer is the reply; `bigbang-reply` is optional there. Silence, a failure or the run ending answers with a failed reply, so the asker is never left waiting.

- **Admission.** A mailbox turn waits while its assistant runs a chat reply elsewhere, and fails as `admission_timeout` after 10 minutes. The first wait is stored, so the timeout survives restarts.
- **Wakeup.** A reply wakes the lane that asked once that lane is idle, with up to five replies in one turn. Nothing from a mailbox lane is posted to a chat.
- **Limits.** One new peer per root (the user message the asking turn answers), counted across assistants and Studio agents. A mailbox lane cannot send.
- **Fence.** Stopping the asking reply fences its root: open requests are cancelled, running ones stopped, and late replies refused. A newer user message superseding the reply does not fence.
- **Context.** The mailbox lane is its own execution: it sees the request, its memory files and its tools, not the asker's chat.

Assistants should not use Paseo's own `send_agent_prompt`: its finish notification arrives as a user message and ends the anchored turn early, as text typed in Studio does.

## Studio collaboration

A Studio binds workspaces on any machine; a workspace belongs to one Studio at a time, and each binding has a token (ported from Bigbang Core's herdr Studio). The agents in bound workspaces are members, except Bigbang's own executions. Members use the same `bigbang-*` tools: `peers`, `send` (1-8 members by name, address `machine/workspace/agent` or key), `reply` and `records`. Each new member gets one notice per binding.

| Receipt         | Meaning                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`      | The recipient's session took the message (Paseo `agents.send`, steered)                                                                                                 |
| `not_attempted` | The recipient's machine was offline; never sent later. Name the recipient by key: members on an offline machine drop out of the member list, so a name does not resolve |
| `rejected`      | The send failed                                                                                                                                                         |
| `unknown`       | No answer within 10 seconds, or the coordinator restarted mid-attempt; never resent                                                                                     |

A reply reaches the original sender only while both bindings are the ones they had; unbinding and binding again refuses replies to older messages.

A Studio links assistants (`studio.assistants.set`). Its members see them as peers, and they see its members. A member's message to an assistant is a mailbox request in the assistant's lane, and the answer returns as a Studio reply while the member's binding is unchanged. An assistant's message to a member is a mailbox row (fan-out, fences, wakeup) carried by a Studio record (delivery, receipt); a delivery that fails answers the assistant with a failed reply.

## Memory

Each assistant keeps `MEMORY.md` and `notes/` in its home directory and maintains them with its own file tools. The form only seeds `MEMORY.md` for a new assistant; the Memory tab edits it through `chat.assistant.memory.*` with an mtime precondition. Group members share visible history, not memory.
