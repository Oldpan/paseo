# Bigbang Chat coordination

How the Bigbang Chat plugin (`extensions/bigbang`) runs chat on Paseo executions. Product decisions and acceptance status live in the [Bigbang roadmap](bigbang-roadmap.md); local setup lives in [development](development.md#bigbang-fork-isolation).

## Ownership

The plugin's SQLite ledger (`$PASEO_HOME/bigbang/chat.sqlite`) owns chat: assistants, chats, messages, turns, tasks, roundtable epochs, mention cooldowns and the Peer Inbox. Paseo agents only execute. Never infer chat state from an agent's title, labels or free text.

| Chat identity                         | Execution                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------- |
| One chat + thread + assistant         | One durable Paseo agent, created once and continued; never replaced        |
| One assistant                         | One background workspace on the coordinator host, holding its memory files |
| One task (user- or assistant-started) | Its own workspace and agent on the chosen host, visible in Studio          |

Chat executions live in background workspaces so they stay out of the Studio sidebar. A host without `features.backgroundWorkspaces` cannot host a chat execution; update it rather than adding a fallback.

## A turn

1. Persist the turn as prepared, then send only the messages that execution has not seen, with `messageId` set to the turn id. Native history already holds earlier turns; replaying the chat creates conflicting histories.
2. The `user_message` whose `messageId` equals the turn id anchors the turn in the execution's timeline. Recovery after a crash looks for that anchor: present means accepted, absent means send the same message again.
3. When the turn ends, read the anchored slice of the timeline and commit its final assistant text as `final:<turnId>`. Do not use `waitForFinish().lastMessage`: it has no anchor and races with the next turn or with input typed in Studio. Codex starts a new assistant item with `\n\n---\n\n`; the final answer is the last item, with that marker removed.
4. A reply of exactly `(pass)` commits nothing. Silence is a valid answer for awareness, mention, Peer Inbox and roundtable turns.

The final answer is the chat message. There is no send tool and no repair turn: Paseo's timeline already gives a reliable reply and live streaming.

## Events and recovery

Plugin lifecycle hooks (`agent.turn_ended`, `agent.permission_*`, `agent.closed`, `agent.archived`) drive local executions. They are best-effort, unreplayed and fire only on the plugin's own daemon. Each hook only enqueues work; every settle re-reads the timeline, so a duplicated or missed hook converges. Tasks on other hosts are observed through agent subscriptions on `hosts.client(serverId)`. A 60-second sweep and startup recovery through `server.paseo` cover what hooks miss.

An execution that closes mid-turn fails that turn with an "Interrupted" error and keeps the same agent; the next message resumes it. Never guess a reply from partial output. The one gap: a turn that finished, whose hook was missed just before a daemon restart, also settles as interrupted, because the timeline keeps no turn-end record.

## Clients

Plugins cannot push to clients, so `chat.state` is a cursor long-poll: it holds a request with `waitMs` until the ledger moves. Keep `waitMs` at 20 seconds or less; plugin requests time out at 30.

The client streams a live reply by reading the bound execution's timeline from the session store: it registers the agent with `viewedTimelineSync.replaceVisibleAgentIds` and renders the text after the turn's anchor. The bubble gives way to the committed final. Pending approvals render inline with Paseo's `PermissionRequestCard`.

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

Assistants start tasks through plugin agent tools (`bigbang-start_task`, `bigbang-task_status`). The daemon binds the caller with a per-agent token ([plugin agent tools](plugins.md#agent-tools), [SECURITY.md](../SECURITY.md)). The plugin authorizes every call from its own ledger: the caller's chat session, current membership, the assistant's autonomy setting and authorized targets, and a live reply turn. Labels and tool input never authorize.

- Every chat execution sees the task tools from creation. Codex lists MCP tools once per session, and Grok connects MCP only when a session is created, never when Paseo loads it again, so admitting only assistants that have autonomy would hide the tools from a session that started before autonomy was enabled.
- Targets record the machine's name when saved, so "start it on Spark" resolves to a `serverId`.
- A worktree task's first prompt says to work only inside its worktree. Briefs written in chat name the source checkout by absolute path, and a worker otherwise edits that checkout.
- Limits are plugin settings: parallel tasks (2), work agents per task (3, enforced by cancelling extras after the fact) and budget minutes (30). Over-limit tasks queue; an expired budget stops the run until the user replies in the task thread.

A task's root message opens its thread; results and follow-ups land there, and a follow-up continues the same executor. The requesting chat receives idempotent lifecycle rows. An assistant that started a task gets one receipt turn to report back.

## Memory

Each assistant keeps `MEMORY.md` and `notes/` in its home directory and maintains them with its own file tools. The form only seeds `MEMORY.md` for a new assistant; the Memory tab edits it through `chat.assistant.memory.*` with an mtime precondition. Group members share visible history, not memory.
