import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callAgentTool } from "./agent-tools";
import {
  AssistantBrowserManager,
  type BrowserObservationInput,
  type BrowserSessionDriver,
  type BrowserTabInfo,
  IDLE_TIMEOUT_MS,
  PASSWORD_MASK,
  checkBrowserUrlPolicy,
  redactBrowserObservation,
} from "./browser";
import { Coordinator } from "./coordinator";
import { FakeExecution } from "./execution.fake";
import { ChatStore } from "./store";

const SKY_ID = "3a60bb8e-3065-44f1-81ec-d3ce929fded2";

function createFakeDriverState() {
  let currentUrl: string | null = "https://example.com/login";
  let currentTitle = "Sign in · Example";
  let closed = false;
  const actions: string[] = [];
  let tabs: BrowserTabInfo[] = [
    { index: 0, url: "https://example.com/login", title: "Sign in · Example", active: true },
  ];
  let observation: BrowserObservationInput = {
    url: currentUrl,
    title: currentTitle,
    text: "Sign in with your account. Card 4111 1111 1111 1111",
    elements: [
      { ref: "@e1", role: "textbox", name: "Email", type: "email", value: "ada@example.com" },
      { ref: "@e2", role: "password", name: "Password", type: "password", value: "hunter2secret" },
      { ref: "@e3", role: "button", name: "Sign in", type: "submit" },
    ],
    screenshotDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  };

  const driver: BrowserSessionDriver = {
    async goto(url: string) {
      actions.push(`goto:${url}`);
      currentUrl = url;
      observation = { ...observation, url };
      tabs = tabs.map((tab) => (tab.active ? { ...tab, url } : tab));
    },
    async reload() {
      actions.push("reload");
    },
    async currentUrl() {
      return currentUrl;
    },
    async tabs() {
      return tabs;
    },
    async selectTab(index: number) {
      tabs = tabs.map((tab, i) => ({
        index: tab.index,
        url: tab.url,
        title: tab.title,
        active: i === index,
      }));
      currentUrl = tabs[index]?.url ?? currentUrl;
      return tabs;
    },
    async closeTab(index?: number) {
      const target = index ?? tabs.findIndex((t) => t.active);
      tabs = tabs
        .filter((_, i) => i !== target)
        .map((tab, i) => ({ index: i, url: tab.url, title: tab.title, active: i === 0 }));
      currentUrl = tabs[0]?.url ?? null;
      return tabs;
    },
    async observe(options) {
      return {
        ...observation,
        url: currentUrl,
        title: currentTitle,
        screenshotDataUrl: options?.includeScreenshot ? observation.screenshotDataUrl : null,
      };
    },
    async click(target) {
      actions.push(`click:${target.ref ?? `${target.x},${target.y}`}`);
    },
    async fill(target) {
      actions.push(`fill:${target.ref ?? "focused"}=${target.value}`);
    },
    async press(key) {
      actions.push(`press:${key}`);
    },
    async scroll(deltaY) {
      actions.push(`scroll:${deltaY}`);
    },
    async wait(options) {
      actions.push(`wait:${options.text ?? options.urlIncludes ?? options.ms ?? 0}`);
    },
    async close() {
      closed = true;
      actions.push("close");
    },
  };

  return {
    driver,
    actions,
    isClosed: () => closed,
    setUrl: (url: string) => {
      currentUrl = url;
    },
  };
}

describe("Pavra browser security policy & redaction", () => {
  it("blocks non-http(s) schemes, cloud metadata, loopback, and RFC1918/IPv6 private addresses unless allowlisted", () => {
    expect(checkBrowserUrlPolicy("file:///etc/passwd").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("javascript:alert(1)").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("data:text/html,<h1>Hi</h1>").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("chrome://settings").allowed).toBe(false);

    expect(checkBrowserUrlPolicy("http://127.0.0.1:6767/health").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://localhost:6778").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://sub.localhost:3000").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://0.0.0.0:8080").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://10.0.0.42/admin").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://172.16.0.1/status").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://172.31.255.255/status").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://192.168.1.1/router").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://169.254.169.254/latest/meta-data/").allowed).toBe(false);
    expect(
      checkBrowserUrlPolicy("http://metadata.google.internal/computeMetadata/v1/").allowed,
    ).toBe(false);
    expect(checkBrowserUrlPolicy("http://[::1]:6767").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://[fd00::1]:8080").allowed).toBe(false);
    expect(checkBrowserUrlPolicy("http://[fe80::1]:8080").allowed).toBe(false);

    // Public IP in 172.32.x.x is allowed
    expect(checkBrowserUrlPolicy("https://172.32.0.1/").allowed).toBe(true);
    expect(checkBrowserUrlPolicy("https://example.com/path").allowed).toBe(true);

    // Explicitly allowlisted private host is permitted
    const withPrivateAllow = {
      enabled: true,
      allowPrivateHosts: ["192.168.1.1", "localhost"],
    };
    expect(checkBrowserUrlPolicy("http://192.168.1.1/status", withPrivateAllow)).toMatchObject({
      allowed: true,
      decision: "allow",
    });
    expect(checkBrowserUrlPolicy("http://localhost:3000/app", withPrivateAllow)).toMatchObject({
      allowed: true,
      decision: "allow",
    });
    expect(checkBrowserUrlPolicy("http://127.0.0.1:6767", withPrivateAllow).allowed).toBe(false);
  });

  it("enforces domain allow/ask/deny policies", () => {
    const policy = {
      enabled: true,
      allowDomains: ["github.com", "docs.example.com"],
      askDomains: ["checkout.stripe.com"],
      denyDomains: ["blocked.github.com", "evil.org"],
    };

    expect(checkBrowserUrlPolicy("https://github.com/getpaseo", policy)).toMatchObject({
      allowed: true,
      decision: "allow",
    });
    expect(checkBrowserUrlPolicy("https://api.github.com/repos", policy)).toMatchObject({
      allowed: true,
      decision: "allow",
    });
    expect(checkBrowserUrlPolicy("https://blocked.github.com/secret", policy)).toMatchObject({
      allowed: false,
      decision: "deny",
    });
    expect(checkBrowserUrlPolicy("https://evil.org", policy)).toMatchObject({
      allowed: false,
      decision: "deny",
    });
    expect(checkBrowserUrlPolicy("https://unlisted.org", policy)).toMatchObject({
      allowed: false,
      decision: "deny",
    });

    // askDomains allows read-only navigation with decision "ask", blocks mutating actions
    expect(
      checkBrowserUrlPolicy("https://checkout.stripe.com/pay", policy, { mutating: false }),
    ).toMatchObject({
      allowed: true,
      decision: "ask",
    });
    expect(
      checkBrowserUrlPolicy("https://checkout.stripe.com/pay", policy, { mutating: true }),
    ).toMatchObject({
      allowed: false,
      decision: "ask",
    });
  });

  it("redacts password input values, card numbers, and secret tokens from observations", () => {
    const raw: BrowserObservationInput = {
      url: "https://example.com/account",
      title: "Account token sk-proj1234567890abcdef",
      text: "Card on file: 4111 1111 1111 1111 and token ghp_1234567890abcdefghijklmnop",
      elements: [
        {
          ref: "@e1",
          role: "textbox",
          name: "Email",
          type: "email",
          value: "user@example.com",
        },
        {
          ref: "@e2",
          role: "textbox",
          name: "Account Password",
          type: "password",
          value: "super-secret-password",
        },
        {
          ref: "@e3",
          role: "textbox",
          name: "Credit Card",
          type: "text",
          value: "4532-0151-1283-0366",
        },
      ],
      screenshotDataUrl: "data:image/jpeg;base64,abc",
    };

    const redacted = redactBrowserObservation(raw);
    expect(redacted.elements[0]?.value).toBe("user@example.com");
    expect(redacted.elements[1]?.value).toBe(PASSWORD_MASK);
    expect(redacted.elements[2]?.value).toBe(PASSWORD_MASK);
    expect(redacted.title).toBe(`Account token ${PASSWORD_MASK}`);
    expect(redacted.text).not.toContain("4111 1111 1111 1111");
    expect(redacted.text).not.toContain("ghp_1234567890abcdefghijklmnop");
    expect(redacted.text).toContain(PASSWORD_MASK);
  });
});

describe("AssistantBrowserManager & Coordinator Takeover Lifecycle", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pavra-browser-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates persistent profile & downloads directories, executes steps, and respects 10-minute idle timeout unless takeover is pending", async () => {
    const root = makeTempDir();
    let now = 1_000;
    let takeoverPending = false;
    const fake = createFakeDriverState();

    const manager = new AssistantBrowserManager({
      now: () => now,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      hasPendingTakeover: () => takeoverPending,
      driverFactory: async () => fake.driver,
    });

    const homeDir = path.join(root, "assistants", SKY_ID);
    const openObs = await manager.open({
      assistantId: SKY_ID,
      homeDir,
      policy: { enabled: true },
      url: "https://example.com/login",
      includeScreenshot: true,
    });

    expect(existsSync(path.join(homeDir, "browser-profile"))).toBe(true);
    expect(existsSync(path.join(homeDir, "downloads"))).toBe(true);
    expect(openObs.url).toBe("https://example.com/login");
    expect(openObs.elements.find((e) => e.ref === "@e2")?.value).toBe(PASSWORD_MASK);
    expect(openObs.screenshotDataUrl).toContain("data:image/jpeg;base64,");

    const stepResult = await manager.steps({
      assistantId: SKY_ID,
      homeDir,
      policy: { enabled: true },
      steps: [
        { action: "fill", ref: "@e1", value: "ada@example.com" },
        { action: "click", ref: "@e3" },
        { action: "wait", ms: 100 },
      ],
    });
    expect(stepResult.completedSteps).toBe(3);
    expect(fake.actions).toContain("fill:@e1=ada@example.com");
    expect(fake.actions).toContain("click:@e3");

    // While takeover is pending, idle sweep does NOT close the browser
    takeoverPending = true;
    now += IDLE_TIMEOUT_MS + 5_000;
    expect(await manager.sweepIdle(now)).toEqual([]);
    expect(manager.isActive(SKY_ID)).toBe(true);

    // Once takeover is resolved, idle sweep closes the browser
    takeoverPending = false;
    expect(await manager.sweepIdle(now)).toEqual([SKY_ID]);
    expect(manager.isActive(SKY_ID)).toBe(false);
    expect(fake.isClosed()).toBe(true);

    await manager.stopAll();
  });

  it("handles browser_hand_to_user -> pending Takeover -> resolveTakeover -> enqueues continuation turn", async () => {
    const root = makeTempDir();
    let now = 10_000;
    const store = new ChatStore(":memory:");
    const execution = new FakeExecution();
    const fake = createFakeDriverState();
    const browserManager = new AssistantBrowserManager({
      now: () => now,
      driverFactory: async () => fake.driver,
    });

    const coordinator = new Coordinator(store, root, {
      execution,
      now: () => now,
      browserManager,
    });
    coordinator.attach();

    const assistant = coordinator.saveAssistant({
      id: SKY_ID,
      name: "Sky",
      provider: "codex/gpt-5",
      persona: "Helpful assistant",
      browser: {
        enabled: true,
        allowDomains: ["example.com"],
      },
    });
    const conversation = coordinator.createConversation({
      id: "conv-sky",
      name: "Sky",
      kind: "dm",
      members: [assistant.id],
      roundtable: false,
    });

    // Send a user message to start a live turn for Sky
    const msgId = "11111111-1111-4111-8111-111111111111";
    coordinator.send({
      id: msgId,
      conversationId: conversation.id,
      threadId: null,
      content: "Log into example.com and check my dashboard",
    });
    await coordinator.idle();

    const firstTurn = store.snapshot().turns[0]!;
    expect(firstTurn).toBeDefined();
    expect(firstTurn.status).toBe("running");

    // Assistant calls browser_open then browser_hand_to_user during its live turn
    await callAgentTool(
      coordinator,
      { agentId: firstTurn.agentId, serverId: undefined as unknown as string },
      "browser_open",
      { url: "https://example.com/login", includeScreenshot: true },
    );

    const handResult = (await callAgentTool(
      coordinator,
      { agentId: firstTurn.agentId, serverId: undefined as unknown as string },
      "browser_hand_to_user",
      { reason: "Please complete 2FA verification on Example.com" },
    )) as { status: string; takeoverId: string; instruction: string };

    expect(handResult.status).toBe("handed_to_user");
    expect(handResult.takeoverId).toBeTruthy();
    expect(handResult.instruction).toContain("end your turn now");

    // Verify pending takeover is stored in ledger state
    const stateAfterHand = store.snapshot();
    expect(stateAfterHand.takeovers).toHaveLength(1);
    const pendingTakeover = stateAfterHand.takeovers![0]!;
    expect(pendingTakeover).toMatchObject({
      id: handResult.takeoverId,
      kind: "browser",
      status: "pending",
      assistantId: assistant.id,
      conversationId: conversation.id,
      threadId: null,
      turnId: firstTurn.id,
      reason: "Please complete 2FA verification on Example.com",
      url: "https://example.com/login",
      title: "Sign in · Example",
    });
    expect(pendingTakeover.screenshotDataUrl).toContain("data:image/jpeg;base64,");

    // Finish the first turn (assistant ends its turn after handing to user)
    execution.say(
      firstTurn.agentId,
      "I paused at the 2FA screen. Please complete it and click Continue.",
    );
    execution.finish(firstTurn.agentId);
    coordinator.onTurnEnded({
      agent: { id: firstTurn.agentId },
      outcome: { kind: "completed" },
    });
    await coordinator.idle();

    // User interacts remotely via browserRemoteAction
    now += 1_000;
    const remoteState = await coordinator.browserRemoteAction({
      assistantId: assistant.id,
      action: "fill",
      ref: "@e1",
      value: "123456",
    });
    expect(remoteState.active).toBe(true);
    expect(fake.actions).toContain("fill:@e1=123456");

    // User clicks "Done, continue" -> resolveTakeover
    now += 1_000;
    const resolved = coordinator.resolveTakeover({
      id: pendingTakeover.id,
    });
    expect(resolved.status).toBe("resolved");
    await coordinator.idle();

    const stateAfterResolve = store.snapshot();
    expect(stateAfterResolve.takeovers?.[0]?.status).toBe("resolved");
    const turns = stateAfterResolve.turns;
    expect(turns).toHaveLength(2);
    const continuationTurn = turns[1]!;
    expect(continuationTurn.assistantId).toBe(assistant.id);
    expect(continuationTurn.conversationId).toBe(conversation.id);
    expect(continuationTurn.threadId).toBeNull();
    expect(continuationTurn.prompt).toContain(
      "The user completed the requested takeover action. Observe the current state first and continue.",
    );

    await coordinator.close();
    store.close();
  });
});
