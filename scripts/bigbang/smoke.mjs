import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPaseoClient } from "../../packages/client/dist/index.js";

process.env.NO_PROXY = "127.0.0.1,localhost,100.107.11.10";
process.env.no_proxy = process.env.NO_PROXY;

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const stateRoot = path.join(repoRoot, ".dev", "bigbang");
const passwordFile = path.join(stateRoot, "tailscale-daemon-password.txt");
const reportPath = path.join(stateRoot, "smoke-report.json");
const SMOKE_MEMORY_LINE = "- Smoke preference: concise verification replies.\n";
const STALE_MEMORY_CONTENT = "stale smoke write should not persist\n";

function resolveDaemonPassword() {
  if (process.env.PASEO_PASSWORD) return process.env.PASEO_PASSWORD;
  if (existsSync(passwordFile)) return readFileSync(passwordFile, "utf8").trim();
  return undefined;
}

function channelSlug(conversationId, conversationName) {
  const idSuffix = conversationId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toLowerCase();
  const namePart = (conversationName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  let slug;
  if (namePart) {
    if (idSuffix) {
      const budget = 80 - idSuffix.length - 1;
      const trimmed = budget > 0 ? namePart.slice(0, budget).replace(/-$/, "") : "";
      slug = trimmed ? `${trimmed}-${idSuffix}` : idSuffix;
    } else {
      slug = namePart.slice(0, 80).replace(/-$/, "");
    }
  } else {
    slug =
      conversationId
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || idSuffix;
  }
  if (slug.length > 80) slug = slug.slice(0, 80).replace(/-$/, "");
  return slug || idSuffix || "channel";
}

function isoWeekKey(timestampMs) {
  const d = new Date(timestampMs);
  const date = d.toISOString().slice(0, 10);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNumber = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  const week = `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
  return { week, date };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(fn, { timeoutMs = 30000, intervalMs = 1000, description = "operation" } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

function invoke(client, method, input = {}) {
  return client.plugins.invoke("bigbang", method, input);
}

async function ignoreError(label, fn) {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Ignoring ${label}: ${message}`);
  }
}

function isCleanMemory(content) {
  const trimmed = content.trim();
  return trimmed === "" || trimmed === SMOKE_MEMORY_LINE.trim();
}

async function readMemory(coordinator, assistantId) {
  return invoke(coordinator, "chat.assistant.memory.read", { assistantId });
}

async function writeMemory(coordinator, assistantId, content, expectedMtimeMs) {
  return invoke(coordinator, "chat.assistant.memory.write", {
    assistantId,
    content,
    expectedMtimeMs,
  });
}

async function restoreMemory(coordinator, assistantId, content) {
  const latest = await readMemory(coordinator, assistantId);
  if (latest.content === content) return latest;
  return writeMemory(coordinator, assistantId, content, latest.mtimeMs);
}

async function expectStaleMemoryWriteRejected(coordinator, assistantId, label, staleMtimeMs) {
  try {
    await writeMemory(coordinator, assistantId, STALE_MEMORY_CONTENT, staleMtimeMs);
    assert.fail(`Expected stale ${label} memory write to be rejected`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.match(
      String(error instanceof Error ? error.message : error),
      /changed since/i,
      `Expected ${label} stale write to fail the expectedMtimeMs precondition`,
    );
  }
}

async function exerciseMemory(coordinator, assistantId, label) {
  const original = await readMemory(coordinator, assistantId);
  const shouldClean = isCleanMemory(original.content);
  const contentToWrite = shouldClean ? SMOKE_MEMORY_LINE : original.content;
  let after;
  try {
    after = await writeMemory(coordinator, assistantId, contentToWrite, original.mtimeMs);
    assert(after.mtimeMs > 0, `Expected ${label} memory write to return mtimeMs > 0`);
    const staleMtimeMs =
      original.mtimeMs === after.mtimeMs ? original.mtimeMs - 1 : original.mtimeMs;
    await expectStaleMemoryWriteRejected(coordinator, assistantId, label, staleMtimeMs);
    const still = await readMemory(coordinator, assistantId);
    assert.equal(
      still.content,
      after.content,
      `Expected rejected stale ${label} write to leave MEMORY.md unchanged`,
    );
  } finally {
    if (shouldClean) {
      await ignoreError(`restore ${label} memory`, () =>
        restoreMemory(coordinator, assistantId, ""),
      );
    }
  }
  const restored = await readMemory(coordinator, assistantId);
  if (shouldClean) {
    assert.equal(restored.content.trim(), "", `Expected ${label} MEMORY.md to be left clean`);
  } else {
    assert.equal(restored.content, original.content, `Expected ${label} MEMORY.md to be unchanged`);
  }
  return {
    before: original,
    after,
    restored,
    staleRejected: true,
    restoredEmpty: shouldClean,
  };
}

function findThreadAnchor(messages, conversationId) {
  const usedThreadIds = new Set(messages.map((message) => message.threadId).filter(Boolean));
  const preferred = messages.find(
    (message) => message.conversationId === conversationId && !usedThreadIds.has(message.id),
  );
  const fallback = messages.find((message) => message.conversationId === conversationId);
  const anchor = preferred ?? fallback;
  return { usedThreadIds, anchor, threadId: anchor ? anchor.id : null };
}

async function waitForMachines(coordinator) {
  return poll(
    async () => {
      const { machines } = await invoke(coordinator, "chat.machines", {});
      const coordinatorMachine = machines.find((machine) => machine.role === "coordinator");
      const memberMachine = machines.find((machine) => machine.role === "member");
      if (coordinatorMachine && memberMachine) {
        return { coordinatorMachine, memberMachine, machines };
      }
      return null;
    },
    {
      timeoutMs: 15000,
      intervalMs: 1000,
      description: "both coordinator and member machines online",
    },
  );
}

async function waitForTurn(coordinator, triggerId, label) {
  return poll(
    async () => {
      const state = await invoke(coordinator, "chat.state", { after: 0 });
      const turn = state.turns.find((item) => item.triggerId === triggerId);
      if (!turn) return null;
      if (turn.status === "failed") {
        throw new Error(`${label} turn failed: ${turn.error ?? "unknown error"}`);
      }
      if (turn.status !== "completed") return null;
      const finalMsg = state.messages.find((message) => message.id === `final:${turn.id}`);
      return finalMsg ? { turn, finalMsg } : null;
    },
    {
      timeoutMs: 60000,
      intervalMs: 2000,
      description: `${label} turn completion and final message`,
    },
  );
}

async function sendAndAwaitTurn(coordinator, { conversationId, threadId, content, label }) {
  const messageId = randomUUID();
  console.log(`Sending prompt to ${label} (threadId: ${threadId ?? "root"})...`);
  await invoke(coordinator, "chat.message.send", {
    id: messageId,
    conversationId,
    threadId,
    content,
  });
  const result = await waitForTurn(coordinator, messageId, label);
  console.log(`${label} turn completed: ${result.turn.id}, reply: "${result.finalMsg.content}"`);
  return { messageId, result };
}

function taskCompletionProbe(coordinator, taskId, resources, workspaceKey = "taskWorkspaceId") {
  return async () => {
    const state = await invoke(coordinator, "chat.state", { after: 0 });
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    if (task.execution?.workspaceId) resources[workspaceKey] = task.execution.workspaceId;
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(`Task ended prematurely: ${task.status} (${task.error ?? "no error"})`);
    }
    if (task.status !== "completed") return null;
    const resultMessage = state.messages.find((message) => message.id === `result:${taskId}`);
    if (!resultMessage || !task.execution?.workspaceId) return null;
    return { task, resultMessage };
  };
}

function notesSyncProbe({ workLogPath, channelNotesPath, taskId }) {
  return () => {
    if (!existsSync(workLogPath) || !existsSync(channelNotesPath)) return false;
    const workLogText = readFileSync(workLogPath, "utf8");
    const channelText = readFileSync(channelNotesPath, "utf8");
    return (
      workLogText.includes(`<!-- task-outcome:${taskId}:${taskId} -->`) &&
      workLogText.includes("Smoke memory verification") &&
      channelText.includes("## Recent Durable Outcomes") &&
      channelText.includes("<!-- recent-durable-outcomes:start -->") &&
      channelText.includes(`<!-- task-id:${taskId} -->`)
    );
  };
}

async function lookupTaskWorkspaceId(coordinator, taskId) {
  const state = await invoke(coordinator, "chat.state", { after: 0 });
  const task = state.tasks.find((item) => item.id === taskId);
  return task?.execution?.workspaceId;
}

async function cleanupSmokeResources(client, resources, evidence) {
  const coordinator = resources.coordinator ?? client;
  if (!resources.taskWorkspaceId && resources.taskId) {
    await ignoreError("lookup task workspace", async () => {
      const workspaceId = await lookupTaskWorkspaceId(coordinator, resources.taskId);
      if (workspaceId) resources.taskWorkspaceId = workspaceId;
    });
  }
  if (!resources.skyTaskWorkspaceId && resources.skyTaskId) {
    await ignoreError("lookup sky task workspace", async () => {
      const workspaceId = await lookupTaskWorkspaceId(coordinator, resources.skyTaskId);
      if (workspaceId) resources.skyTaskWorkspaceId = workspaceId;
    });
  }
  if (resources.taskId) {
    await ignoreError("cancel task", () =>
      invoke(coordinator, "chat.task.cancel", { id: resources.taskId }),
    );
  }
  if (resources.skyTaskId) {
    await ignoreError("cancel sky task", () =>
      invoke(coordinator, "chat.task.cancel", { id: resources.skyTaskId }),
    );
  }
  if (resources.studioId) {
    await ignoreError("archive studio", () =>
      invoke(coordinator, "studio.archive", { id: resources.studioId }),
    );
  }
  if (resources.taskWorkspaceId) {
    await ignoreError("archive task workspace", () =>
      client.workspaces.archive(resources.taskWorkspaceId),
    );
  }
  if (resources.skyTaskWorkspaceId) {
    await ignoreError("archive sky task workspace", () =>
      coordinator.workspaces.archive(resources.skyTaskWorkspaceId),
    );
  }
  if (resources.tempDir) {
    await ignoreError("remove temp dir", async () => {
      rmSync(resources.tempDir, { recursive: true, force: true });
    });
  }

  let coordinatorDisposed = false;
  if (coordinator !== client) {
    await ignoreError("dispose coordinator", async () => {
      if (typeof coordinator.dispose === "function") {
        await coordinator.dispose();
        coordinatorDisposed = true;
      }
    });
  }
  await ignoreError("close client", () => client.close());

  evidence.cleanup = {
    tempDir: resources.tempDir ?? null,
    studioId: resources.studioId ?? null,
    taskWorkspaceId: resources.taskWorkspaceId ?? null,
    skyTaskId: resources.skyTaskId ?? null,
    skyTaskWorkspaceId: resources.skyTaskWorkspaceId ?? null,
    coordinatorDisposed,
  };
  if (evidence.step5) evidence.step5.cleanedUp = true;
}

async function step1(coordinator, evidence) {
  console.log("\n[Step 1] Verifying machines and locating Sky & Max...");
  const machinesResult = await waitForMachines(coordinator);
  console.log("Machines verified online:", machinesResult.machines);

  const state = await invoke(coordinator, "chat.state", { after: 0 });
  const sky = state.assistants.find(
    (assistant) => assistant.name === "Sky" && assistant.provider.startsWith("grok/"),
  );
  assert(sky, "Could not locate Sky (grok) assistant in chat.state");
  const max = state.assistants.find(
    (assistant) => assistant.name === "Max" && assistant.provider.startsWith("codex/"),
  );
  assert(max, "Could not locate Max (codex) assistant in chat.state");
  assert(max.serverId, "Expected Max assistant to be bound to a member serverId");

  const skyDm = state.conversations.find(
    (conversation) => conversation.kind === "dm" && conversation.members.includes(sky.id),
  );
  assert(skyDm, "Could not locate DM conversation for Sky");
  const maxDm = state.conversations.find(
    (conversation) => conversation.kind === "dm" && conversation.members.includes(max.id),
  );
  assert(maxDm, "Could not locate DM conversation for Max");

  console.log(`Located Sky: ${sky.id} (${sky.provider}) on ${sky.serverId ?? "coordinator"}`);
  console.log(`Located Max: ${max.id} (${max.provider}) on ${max.serverId}`);
  console.log(`Sky DM: ${skyDm.id}, Max DM: ${maxDm.id}`);
  evidence.step1 = {
    machines: machinesResult.machines,
    sky: {
      id: sky.id,
      name: sky.name,
      provider: sky.provider,
      serverId: sky.serverId ?? null,
      dmId: skyDm.id,
    },
    max: {
      id: max.id,
      name: max.name,
      provider: max.provider,
      serverId: max.serverId,
      dmId: maxDm.id,
    },
  };
  return {
    sky,
    max,
    skyDm,
    maxDm,
    coordinatorMachine: machinesResult.coordinatorMachine,
  };
}

async function step2(coordinator, { sky, max }, evidence) {
  console.log("\n[Step 2] Testing memory read/write and mtime precondition...");
  const maxMemory = await exerciseMemory(coordinator, max.id, "max");
  const skyMemory = await exerciseMemory(coordinator, sky.id, "sky");
  console.log(`Max MEMORY.md updated (mtimeMs: ${maxMemory.after.mtimeMs})`);
  console.log(`Sky MEMORY.md updated (mtimeMs: ${skyMemory.after.mtimeMs})`);
  evidence.step2 = { max: maxMemory, sky: skyMemory };
}

async function step3(coordinator, { skyDm, maxDm }, evidence) {
  console.log("\n[Step 3] Running live turns for Sky and Max in fresh thread sessions...");

  const skyStateBefore = await invoke(coordinator, "chat.state", { after: 0 });
  const skyAnchor = findThreadAnchor(skyStateBefore.messages, skyDm.id);
  const skyTurn = await sendAndAwaitTurn(coordinator, {
    conversationId: skyDm.id,
    threadId: skyAnchor.threadId,
    content: "Reply with the single word SKY_SMOKE_OK and nothing else.",
    label: "Sky",
  });
  if (skyAnchor.threadId && !skyAnchor.usedThreadIds.has(skyAnchor.threadId)) {
    assert(
      skyTurn.result.turn.prompt.includes("[Workspace memory to check if you need it]"),
      "Expected Sky turn prompt in fresh thread session to include workspace memory hint",
    );
  }

  const maxStateBefore = await invoke(coordinator, "chat.state", { after: 0 });
  const maxAnchor = findThreadAnchor(maxStateBefore.messages, maxDm.id);
  assert(maxAnchor.anchor, "Could not find an anchor message in Max DM for thread branch");
  const maxTurn = await sendAndAwaitTurn(coordinator, {
    conversationId: maxDm.id,
    threadId: maxAnchor.threadId,
    content: "Reply with the single word MAX_SMOKE_OK and nothing else. Do not run tools.",
    label: "Max",
  });
  assert(
    maxTurn.result.turn.prompt.includes("[Workspace memory to check if you need it]"),
    "Expected Max turn prompt in fresh thread session to include workspace memory hint",
  );

  evidence.step3 = {
    sky: {
      triggerId: skyTurn.messageId,
      turnId: skyTurn.result.turn.id,
      reply: skyTurn.result.finalMsg.content,
      hasMemoryHint: skyTurn.result.turn.prompt.includes(
        "[Workspace memory to check if you need it]",
      ),
    },
    max: {
      triggerId: maxTurn.messageId,
      turnId: maxTurn.result.turn.id,
      reply: maxTurn.result.finalMsg.content,
      hasMemoryHint: maxTurn.result.turn.prompt.includes(
        "[Workspace memory to check if you need it]",
      ),
    },
  };
}

async function step4(
  coordinator,
  { sky, max, skyDm, maxDm, coordinatorMachine },
  resources,
  evidence,
) {
  console.log(
    "\n[Step 4] Starting task execution on Max and verifying concurrent chat & notes sync...",
  );
  const taskId = randomUUID();
  resources.taskId = taskId;
  resources.tempDir = `/tmp/bigbang-smoke-task-${taskId}`;
  mkdirSync(resources.tempDir, { recursive: true });

  const startedTask = await invoke(coordinator, "chat.task.start", {
    id: taskId,
    conversationId: maxDm.id,
    assistantId: max.id,
    serverId: max.serverId,
    directory: resources.tempDir,
    provider: max.provider,
    isolation: "directory",
    title: "Smoke memory verification",
    prompt: "Reply with TASK_SMOKE_OK only. Do not create or modify any files.",
  });
  if (startedTask.execution?.workspaceId) {
    resources.taskWorkspaceId = startedTask.execution.workspaceId;
  }
  console.log(`Max task started: ${taskId} in ${resources.tempDir}`);

  console.log("Sending concurrent chat message to Max while task runs...");
  const maxChatPromise = sendAndAwaitTurn(coordinator, {
    conversationId: maxDm.id,
    threadId: null,
    content: "While your task runs, reply with MAX_CHAT_CONCURRENT_OK only.",
    label: "Max (concurrent chat)",
  });

  const [maxChatTurn, taskResult] = await Promise.all([
    maxChatPromise,
    poll(taskCompletionProbe(coordinator, taskId, resources, "taskWorkspaceId"), {
      timeoutMs: 120000,
      intervalMs: 2000,
      description: "Max task completion and committed result message",
    }),
  ]);
  resources.taskWorkspaceId = taskResult.task.execution.workspaceId;
  console.log(`Max task completed! Result message: "${taskResult.resultMessage.content}"`);
  console.log(`Max concurrent chat reply: "${maxChatTurn.result.finalMsg.content}"`);

  assert(taskResult.task.execution?.agentId, "Expected Max task to have an execution agentId");
  assert(
    maxChatTurn.result.turn.agentId !== taskResult.task.execution.agentId,
    `Expected Max chat turn agentId (${maxChatTurn.result.turn.agentId}) to differ from task execution agentId (${taskResult.task.execution.agentId})`,
  );
  console.log(
    `Verified Max chat turn agentId (${maxChatTurn.result.turn.agentId}) != task execution agentId (${taskResult.task.execution.agentId})`,
  );

  const maxAssistantDir = path.join(stateRoot, "paseo-home", "bigbang", "assistants", max.id);
  const maxAssistantHome = existsSync(path.join(maxAssistantDir, "home", "notes"))
    ? path.join(maxAssistantDir, "home")
    : maxAssistantDir;

  const { week } = isoWeekKey(taskResult.task.createdAt);
  const workLogPath = path.join(maxAssistantHome, "notes", "work-log", `${week}.md`);
  const slug = channelSlug(maxDm.id, maxDm.name);
  const channelNotesPath = path.join(maxAssistantHome, "notes", "channels", `${slug}.md`);

  await poll(notesSyncProbe({ workLogPath, channelNotesPath, taskId }), {
    timeoutMs: 10000,
    intervalMs: 500,
    description: "work-log and channel notes sync on disk",
  });

  const workLogContent = readFileSync(workLogPath, "utf8");
  const channelNotesContent = readFileSync(channelNotesPath, "utf8");
  console.log(`Verified work-log note at: ${workLogPath}`);
  console.log(`Verified channel note at: ${channelNotesPath}`);

  console.log("\n[Step 4b] Starting task execution on Sky (Grok on Spark) with concurrent chat...");
  const resolvedCoordinatorMachine =
    coordinatorMachine ?? (await waitForMachines(coordinator)).coordinatorMachine;
  const coordinatorServerId = sky.serverId ?? resolvedCoordinatorMachine.serverId;

  const skyTaskId = randomUUID();
  resources.skyTaskId = skyTaskId;

  const startedSkyTask = await invoke(coordinator, "chat.task.start", {
    id: skyTaskId,
    conversationId: skyDm.id,
    assistantId: sky.id,
    serverId: coordinatorServerId,
    directory: "/ai/code/paseo-bigbang",
    provider: sky.provider,
    isolation: "worktree",
    title: "Sky smoke task verification",
    prompt: "Reply with SKY_TASK_OK only. Do not create or modify any files.",
  });
  if (startedSkyTask.execution?.workspaceId) {
    resources.skyTaskWorkspaceId = startedSkyTask.execution.workspaceId;
  }
  console.log(
    `Sky task started: ${skyTaskId} in /ai/code/paseo-bigbang (worktree) on ${coordinatorServerId}`,
  );

  console.log("Sending concurrent chat message to Sky while task runs...");
  const skyChatPromise = sendAndAwaitTurn(coordinator, {
    conversationId: skyDm.id,
    threadId: null,
    content: "While your task runs, reply with SKY_CHAT_CONCURRENT_OK only.",
    label: "Sky (concurrent chat)",
  });

  const [skyChatTurn, skyTaskResult] = await Promise.all([
    skyChatPromise,
    poll(taskCompletionProbe(coordinator, skyTaskId, resources, "skyTaskWorkspaceId"), {
      timeoutMs: 120000,
      intervalMs: 2000,
      description: "Sky task completion and committed result message",
    }),
  ]);
  resources.skyTaskWorkspaceId = skyTaskResult.task.execution.workspaceId;
  console.log(`Sky task completed! Result message: "${skyTaskResult.resultMessage.content}"`);
  console.log(`Sky concurrent chat reply: "${skyChatTurn.result.finalMsg.content}"`);

  assert(skyTaskResult.task.execution?.agentId, "Expected Sky task to have an execution agentId");
  assert(
    skyChatTurn.result.turn.agentId !== skyTaskResult.task.execution.agentId,
    `Expected Sky chat turn agentId (${skyChatTurn.result.turn.agentId}) to differ from task execution agentId (${skyTaskResult.task.execution.agentId})`,
  );
  console.log(
    `Verified Sky chat turn agentId (${skyChatTurn.result.turn.agentId}) != task execution agentId (${skyTaskResult.task.execution.agentId})`,
  );

  evidence.step4 = {
    taskId,
    startedTask,
    task: taskResult.task,
    resultMessage: taskResult.resultMessage,
    maxChatTurn: {
      messageId: maxChatTurn.messageId,
      turnId: maxChatTurn.result.turn.id,
      reply: maxChatTurn.result.finalMsg.content,
      agentId: maxChatTurn.result.turn.agentId,
    },
    skyTaskId,
    startedSkyTask,
    skyTask: skyTaskResult.task,
    skyResultMessage: skyTaskResult.resultMessage,
    skyChatTurn: {
      messageId: skyChatTurn.messageId,
      turnId: skyChatTurn.result.turn.id,
      reply: skyChatTurn.result.finalMsg.content,
      agentId: skyChatTurn.result.turn.agentId,
    },
    workLogPath,
    workLogContent,
    channelNotesPath,
    channelNotesContent,
  };
  return taskResult;
}

async function step5(coordinator, { sky, max }, resources, taskResult, evidence) {
  console.log("\n[Step 5] Testing Studio collaboration mesh and cleanup...");
  const studioId = randomUUID();
  await invoke(coordinator, "studio.save", {
    id: studioId,
    name: "Smoke Studio",
  });
  resources.studioId = studioId;
  console.log(`Created studio: ${studioId}`);

  const taskWorkspaceId = taskResult.task.execution.workspaceId;
  resources.taskWorkspaceId = taskWorkspaceId;
  await invoke(coordinator, "studio.bind", {
    studioId,
    serverId: taskResult.task.execution.serverId,
    workspaceId: taskWorkspaceId,
    name: "Smoke Task Workspace",
  });
  console.log(`Bound task workspace ${taskWorkspaceId} to studio`);

  await invoke(coordinator, "studio.assistants.set", {
    studioId,
    assistantIds: [sky.id, max.id],
  });
  console.log(`Set studio assistants: [Sky, Max]`);

  const studioMembersRes = await invoke(coordinator, "studio.members", { studioId });
  console.log("Studio members result:", JSON.stringify(studioMembersRes, null, 2));

  const taskWorkspaceAgent = studioMembersRes.members.find(
    (member) =>
      member.key ===
        `agent:${taskResult.task.execution.serverId}:${taskResult.task.execution.agentId}` ||
      member.address?.includes(taskWorkspaceId) ||
      member.name === taskResult.task.id.slice(0, 8) ||
      member.name === "Smoke memory verification",
  );
  assert(
    taskWorkspaceAgent,
    `Expected task workspace agent (${taskResult.task.execution.agentId}) to be listed in studio.members`,
  );
  console.log(
    `Found task workspace agent in studio members: ${taskWorkspaceAgent.name} (${taskWorkspaceAgent.address})`,
  );

  evidence.step5 = {
    studioId,
    taskWorkspaceId,
    members: studioMembersRes.members,
    taskWorkspaceAgent,
    cleanedUp: false,
  };
}

async function main() {
  const evidence = {
    startedAt: new Date().toISOString(),
    connection: {},
    step1: {},
    step2: {},
    step3: {},
    step4: {},
    step5: {},
    passed: false,
  };

  console.log("=== Bigbang Live Smoke Verification ===");

  const password = resolveDaemonPassword();
  const daemonUrl = "ws://127.0.0.1:6778/ws";
  console.log(`Connecting Paseo client to ${daemonUrl}...`);

  const client = createPaseoClient({
    url: daemonUrl,
    password,
  });
  const resources = {
    coordinator: client,
    tempDir: undefined,
    studioId: undefined,
    taskId: undefined,
    taskWorkspaceId: undefined,
    skyTaskId: undefined,
    skyTaskWorkspaceId: undefined,
  };

  try {
    await client.connect();

    const hello = await invoke(client, "member.hello", {});
    console.log("Local member.hello response:", hello);

    if (hello.mode === "member" && hello.coordinatorServerId) {
      console.log(`Connecting routed client to coordinator (${hello.coordinatorServerId})...`);
      resources.coordinator = await client.hosts.client(hello.coordinatorServerId);
    }
    evidence.connection = { hello, coordinatorServerId: hello.coordinatorServerId ?? null };

    const located = await step1(resources.coordinator, evidence);
    await step2(resources.coordinator, located, evidence);
    await step3(resources.coordinator, located, evidence);
    const taskResult = await step4(resources.coordinator, located, resources, evidence);
    await step5(resources.coordinator, located, resources, taskResult, evidence);

    evidence.passed = true;
    evidence.completedAt = new Date().toISOString();
    console.log("\n=== ALL STEPS PASSED SUCCESSFULLY ===");
  } finally {
    await cleanupSmokeResources(client, resources, evidence);
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`Evidence report saved to: ${reportPath}`);
  }
}

main().catch((error) => {
  console.error("\nFATAL Bigbang smoke verification failure:", error);
  process.exit(1);
});
