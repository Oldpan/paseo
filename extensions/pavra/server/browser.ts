import { existsSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AssistantBrowserConfig, BrowserElement, BrowserPageState } from "../shared/contracts";

export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const BROWSER_STEP_BUDGET_MS = 25_000;
export const BROWSER_NAVIGATION_TIMEOUT_MS = 25_000;
export const PASSWORD_MASK = "••••••••";

export interface BrowserUrlPolicyResult {
  allowed: boolean;
  decision: "allow" | "ask" | "deny";
  reason?: string;
  hostname?: string;
  normalizedUrl?: string;
}

export interface RawBrowserElement {
  ref: string;
  role: string;
  name: string;
  type?: string;
  value?: string;
  selector?: string;
  x?: number;
  y?: number;
}

export interface BrowserObservationInput {
  url: string | null;
  title: string | null;
  text?: string;
  elements: RawBrowserElement[];
  screenshotDataUrl?: string | null;
}

export interface BrowserObservation {
  url: string | null;
  title: string | null;
  text?: string;
  elements: BrowserElement[];
  screenshotDataUrl: string | null;
}

export interface BrowserTabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export const browserStepSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    url: z.string().min(1),
  }),
  z.object({
    action: z.literal("click"),
    ref: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({
    action: z.literal("fill"),
    ref: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    action: z.literal("press"),
    key: z.string().min(1),
  }),
  z.object({
    action: z.literal("scroll"),
    deltaY: z.number().optional(),
  }),
  z.object({
    action: z.literal("wait"),
    text: z.string().optional(),
    urlIncludes: z.string().optional(),
    ms: z.number().int().min(0).max(25_000).optional(),
  }),
]);
export type BrowserStep = z.infer<typeof browserStepSchema>;

function normalizeHost(raw: string): string {
  return raw
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function parseIpv4Octets(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets as [number, number, number, number];
}

function isCloudMetadataHost(hostname: string): boolean {
  if (
    hostname === "169.254.169.254" ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata" ||
    hostname.endsWith(".metadata.google.internal")
  ) {
    return true;
  }
  if (hostname === "::ffff:169.254.169.254" || hostname === "::ffff:a9fe:a9fe") {
    return true;
  }
  return false;
}

function isPrivateOrLoopbackIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }
  const ipv4 = parseIpv4Octets(hostname);
  if (ipv4) {
    return isPrivateOrLoopbackIpv4(ipv4);
  }
  // IPv6 checks
  if (
    hostname === "::1" ||
    hostname === "::" ||
    hostname === "0:0:0:0:0:0:0:1" ||
    hostname === "0:0:0:0:0:0:0:0"
  ) {
    return true;
  }
  if (hostname.startsWith("::ffff:")) {
    const rest = hostname.slice("::ffff:".length);
    const mappedV4 = parseIpv4Octets(rest);
    if (mappedV4) return isPrivateOrLoopbackIpv4(mappedV4);
    const hexMatch = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch) {
      const hi = Number.parseInt(hexMatch[1]!, 16);
      const lo = Number.parseInt(hexMatch[2]!, 16);
      return isPrivateOrLoopbackIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
    }
  }
  // fc00::/7 (Unique Local Addresses: fc00..fdff)
  if (/^f[cd][0-9a-f]{0,2}:/i.test(hostname)) {
    return true;
  }
  // fe80::/10 (Link-Local Addresses: fe80..febf)
  if (/^fe[89ab][0-9a-f]?:/i.test(hostname)) {
    return true;
  }
  return false;
}

function matchesDomainList(hostname: string, domains?: readonly string[]): boolean {
  if (!domains || domains.length === 0) return false;
  for (const raw of domains) {
    const clean = normalizeHost(raw).replace(/^\*\./, "").replace(/^\./, "");
    if (!clean) continue;
    if (hostname === clean || hostname.endsWith(`.${clean}`)) {
      return true;
    }
  }
  return false;
}

export function checkBrowserUrlPolicy(
  rawUrl: string,
  policy?: Partial<AssistantBrowserConfig>,
  options?: { mutating?: boolean },
): BrowserUrlPolicyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      allowed: false,
      decision: "deny",
      reason: `Invalid URL: ${rawUrl}`,
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      allowed: false,
      decision: "deny",
      reason: `Unsupported URL scheme "${parsed.protocol}". Only http: and https: are allowed.`,
    };
  }

  const hostname = normalizeHost(parsed.hostname);
  if (!hostname) {
    return {
      allowed: false,
      decision: "deny",
      reason: "URL is missing a valid hostname.",
    };
  }

  const allowPrivate = new Set(
    (policy?.allowPrivateHosts ?? []).map((host) => normalizeHost(host)).filter(Boolean),
  );

  if (!allowPrivate.has(hostname)) {
    if (isCloudMetadataHost(hostname)) {
      return {
        allowed: false,
        decision: "deny",
        hostname,
        normalizedUrl: parsed.toString(),
        reason: `Cloud metadata host "${hostname}" is blocked.`,
      };
    }
    if (isPrivateOrLoopbackHost(hostname)) {
      return {
        allowed: false,
        decision: "deny",
        hostname,
        normalizedUrl: parsed.toString(),
        reason: `Loopback or private network host "${hostname}" is blocked unless listed in allowPrivateHosts.`,
      };
    }
  }

  if (matchesDomainList(hostname, policy?.denyDomains)) {
    return {
      allowed: false,
      decision: "deny",
      hostname,
      normalizedUrl: parsed.toString(),
      reason: `Domain "${hostname}" is denied by assistant browser policy.`,
    };
  }

  if (matchesDomainList(hostname, policy?.askDomains)) {
    const mutating = Boolean(options?.mutating);
    return {
      allowed: !mutating,
      decision: "ask",
      hostname,
      normalizedUrl: parsed.toString(),
      reason: `Domain "${hostname}" requires user confirmation or takeover for mutating actions.`,
    };
  }

  if (policy?.allowDomains && policy.allowDomains.length > 0) {
    if (!matchesDomainList(hostname, policy.allowDomains)) {
      return {
        allowed: false,
        decision: "deny",
        hostname,
        normalizedUrl: parsed.toString(),
        reason: `Domain "${hostname}" is not listed in allowDomains.`,
      };
    }
  }

  return {
    allowed: true,
    decision: "allow",
    hostname,
    normalizedUrl: parsed.toString(),
  };
}

export function assertBrowserUrlAllowed(
  rawUrl: string,
  policy?: Partial<AssistantBrowserConfig>,
  options?: { mutating?: boolean },
): BrowserUrlPolicyResult {
  const check = checkBrowserUrlPolicy(rawUrl, policy, options);
  if (!check.allowed) {
    throw new Error(check.reason ?? `Access to URL "${rawUrl}" is not allowed.`);
  }
  return check;
}

const CARD_NUMBER_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const SECRET_TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bghp_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
];

export function redactSensitiveText(text: string): string {
  if (!text) return text;
  let redacted = text.replace(CARD_NUMBER_PATTERN, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19) {
      return PASSWORD_MASK;
    }
    return match;
  });
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, PASSWORD_MASK);
  }
  return redacted;
}

function isPasswordElement(element: RawBrowserElement): boolean {
  const type = element.type?.toLowerCase() ?? "";
  const role = element.role?.toLowerCase() ?? "";
  const name = element.name ?? "";
  if (type === "password" || role === "password") return true;
  if (/password|passwd|passcode|密码/i.test(name) && element.value !== undefined) return true;
  return false;
}

export function redactBrowserObservation(input: BrowserObservationInput): BrowserObservation {
  const elements: BrowserElement[] = input.elements.map((element) => {
    const base: BrowserElement = {
      ref: element.ref,
      role: element.role,
      name: redactSensitiveText(element.name),
    };
    if (element.value !== undefined && element.value !== "") {
      base.value = isPasswordElement(element) ? PASSWORD_MASK : redactSensitiveText(element.value);
    } else if (isPasswordElement(element) && element.value !== undefined) {
      base.value = PASSWORD_MASK;
    }
    return base;
  });

  return {
    url: input.url,
    title: input.title ? redactSensitiveText(input.title) : input.title,
    ...(input.text !== undefined ? { text: redactSensitiveText(input.text) } : {}),
    elements,
    screenshotDataUrl: input.screenshotDataUrl ?? null,
  };
}

export interface BrowserSessionDriver {
  goto(url: string): Promise<void>;
  reload(): Promise<void>;
  currentUrl(): Promise<string | null>;
  tabs(): Promise<BrowserTabInfo[]>;
  selectTab(index: number): Promise<BrowserTabInfo[]>;
  closeTab(index?: number): Promise<BrowserTabInfo[]>;
  observe(options?: { includeScreenshot?: boolean }): Promise<BrowserObservationInput>;
  click(target: { ref?: string; x?: number; y?: number }): Promise<void>;
  fill(target: { ref?: string; value: string }): Promise<void>;
  press(key: string): Promise<void>;
  scroll(deltaY: number): Promise<void>;
  wait(options: { text?: string; urlIncludes?: string; ms?: number }): Promise<void>;
  close(): Promise<void>;
}

function findInPlaywrightEntry(root: string, entry: string): string | undefined {
  const candidates = [
    path.join(root, entry, "chrome-linux", "chrome"),
    path.join(root, entry, "chrome-linux64", "chrome"),
    path.join(root, entry, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    path.join(
      root,
      entry,
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
    path.join(
      root,
      entry,
      "chrome-mac-x64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function findPlaywrightCacheExecutable(): string | undefined {
  const roots = [
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const entries = readdirSync(root)
        .filter((name) => name.startsWith("chromium-"))
        .sort((a, b) => b.localeCompare(a));
      for (const entry of entries) {
        const found = findInPlaywrightEntry(root, entry);
        if (found) return found;
      }
    } catch {}
  }
  return undefined;
}

export function discoverChromiumExecutable(): string | undefined {
  const envCandidates = [
    process.env.PAVRA_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
  ];
  for (const candidate of envCandidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  const systemCandidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : [
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/snap/bin/chromium",
        ];

  for (const candidate of systemCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  return findPlaywrightCacheExecutable();
}

async function createPlaywrightDriver(options: {
  profileDir: string;
  downloadsDir: string;
}): Promise<BrowserSessionDriver> {
  const pw = await import("playwright-core");
  let executablePath: string | undefined;
  try {
    const defaultExec = pw.chromium.executablePath();
    if (defaultExec && existsSync(defaultExec)) {
      executablePath = defaultExec;
    }
  } catch {}
  if (!executablePath) {
    executablePath = discoverChromiumExecutable();
  }

  const context = await pw.chromium.launchPersistentContext(options.profileDir, {
    headless: true,
    acceptDownloads: true,
    downloadsPath: options.downloadsDir,
    viewport: { width: 1280, height: 800 },
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  let activeIndex = 0;
  let refCoordinates = new Map<string, { x: number; y: number }>();

  const ensurePage = async () => {
    const pages = context.pages();
    if (pages.length === 0) {
      const page = await context.newPage();
      activeIndex = 0;
      return page;
    }
    if (activeIndex < 0 || activeIndex >= pages.length) {
      activeIndex = Math.max(0, pages.length - 1);
    }
    return pages[activeIndex]!;
  };

  const listTabs = async (): Promise<BrowserTabInfo[]> => {
    const pages = context.pages();
    const results: BrowserTabInfo[] = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]!;
      let title = "";
      try {
        title = await p.title();
      } catch {}
      results.push({
        index: i,
        url: p.url(),
        title,
        active: i === activeIndex,
      });
    }
    return results;
  };

  return {
    async goto(url: string) {
      const page = await ensurePage();
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
      });
    },
    async reload() {
      const page = await ensurePage();
      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
      });
    },
    async currentUrl() {
      const pages = context.pages();
      if (pages.length === 0) return null;
      const page = await ensurePage();
      return page.url() || null;
    },
    async tabs() {
      return listTabs();
    },
    async selectTab(index: number) {
      const pages = context.pages();
      if (index < 0 || index >= pages.length) {
        throw new Error(
          `Tab index ${index} is out of range (0..${Math.max(0, pages.length - 1)}).`,
        );
      }
      activeIndex = index;
      await pages[activeIndex]!.bringToFront().catch(() => undefined);
      return listTabs();
    },
    async closeTab(index?: number) {
      const pages = context.pages();
      if (pages.length === 0) return [];
      const targetIndex = index ?? activeIndex;
      if (targetIndex < 0 || targetIndex >= pages.length) {
        throw new Error(`Tab index ${targetIndex} is out of range.`);
      }
      await pages[targetIndex]!.close();
      const remaining = context.pages();
      if (activeIndex >= remaining.length) {
        activeIndex = Math.max(0, remaining.length - 1);
      }
      return listTabs();
    },
    async observe(observeOptions) {
      const page = await ensurePage();
      const url = page.url() || null;
      const title = await page.title().catch(() => "");
      const extracted = await page.evaluate(() => {
        interface DomElementLike {
          tagName: string;
          innerText?: string;
          name?: string;
          id?: string;
          type?: string;
          value?: string;
          getBoundingClientRect(): { left: number; top: number; width: number; height: number };
          getAttribute(name: string): string | null;
          setAttribute(name: string, value: string): void;
        }
        const dom = globalThis as unknown as {
          document: {
            querySelectorAll(selector: string): Iterable<DomElementLike>;
            body?: { innerText?: string };
          };
          window: {
            getComputedStyle(el: DomElementLike): { visibility?: string; display?: string };
          };
        };
        const roleByTag: Record<string, string> = {
          a: "link",
          button: "button",
          select: "combobox",
          textarea: "textbox",
          input: "textbox",
        };
        const resolveRole = (el: DomElementLike, tag: string): string => {
          const explicitRole = el.getAttribute("role");
          if (explicitRole) return explicitRole;
          if (el.type === "password") return "password";
          return roleByTag[tag] ?? tag;
        };
        const resolveLabel = (el: DomElementLike, tag: string): string => {
          const candidates = [
            el.getAttribute("aria-label"),
            el.getAttribute("placeholder"),
            el.innerText,
            el.name,
            el.id,
          ];
          const raw = candidates.find((item) => Boolean(item && item.trim())) ?? tag;
          return raw.replace(/\s+/g, " ").trim().slice(0, 120);
        };
        const interactiveSelector =
          'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
        const nodes = Array.from(dom.document.querySelectorAll(interactiveSelector));
        const elements: Array<{
          ref: string;
          role: string;
          name: string;
          type?: string;
          value?: string;
          x: number;
          y: number;
        }> = [];
        for (const el of nodes) {
          if (elements.length >= 60) break;
          const rect = el.getBoundingClientRect();
          const style = dom.window.getComputedStyle(el);
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (style.visibility === "hidden" || style.display === "none") continue;
          const ref = `@e${elements.length + 1}`;
          el.setAttribute("data-pavra-ref", ref);
          const tag = el.tagName.toLowerCase();
          const entry: {
            ref: string;
            role: string;
            name: string;
            type?: string;
            value?: string;
            x: number;
            y: number;
          } = {
            ref,
            role: resolveRole(el, tag),
            name: resolveLabel(el, tag),
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
          if (el.type) entry.type = el.type;
          if (el.value) entry.value = el.value.slice(0, 200);
          elements.push(entry);
        }
        const bodyText = (dom.document.body?.innerText ?? "")
          .replace(/\s+\n/g, "\n")
          .trim()
          .slice(0, 4000);
        return { elements, bodyText };
      });

      refCoordinates = new Map(
        extracted.elements.map((item) => [item.ref, { x: item.x, y: item.y }]),
      );

      let screenshotDataUrl: string | null = null;
      if (observeOptions?.includeScreenshot) {
        const buffer = await page.screenshot({
          type: "jpeg",
          quality: 65,
          scale: "css",
        });
        screenshotDataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      }

      return {
        url,
        title: title || null,
        text: extracted.bodyText,
        elements: extracted.elements,
        screenshotDataUrl,
      };
    },
    async click(target) {
      const page = await ensurePage();
      if (target.ref) {
        const normalizedRef = target.ref.startsWith("@") ? target.ref : `@${target.ref}`;
        const locator = page.locator(`[data-pavra-ref="${normalizedRef}"]`).first();
        const count = await locator.count().catch(() => 0);
        if (count > 0) {
          await locator.click({ timeout: 8_000 });
          return;
        }
        const coords = refCoordinates.get(normalizedRef);
        if (coords) {
          await page.mouse.click(coords.x, coords.y);
          return;
        }
        throw new Error(
          `Element ${normalizedRef} not found on current page. Call browser_observe first.`,
        );
      }
      if (typeof target.x === "number" && typeof target.y === "number") {
        await page.mouse.click(target.x, target.y);
        return;
      }
      throw new Error("Pass either ref (e.g. '@e1') or coordinates { x, y } to click.");
    },
    async fill(target) {
      const page = await ensurePage();
      if (target.ref) {
        const normalizedRef = target.ref.startsWith("@") ? target.ref : `@${target.ref}`;
        const locator = page.locator(`[data-pavra-ref="${normalizedRef}"]`).first();
        const count = await locator.count().catch(() => 0);
        if (count > 0) {
          await locator.fill(target.value, { timeout: 8_000 });
          return;
        }
        const coords = refCoordinates.get(normalizedRef);
        if (coords) {
          await page.mouse.click(coords.x, coords.y);
          await page.keyboard.type(target.value);
          return;
        }
        throw new Error(
          `Element ${normalizedRef} not found on current page. Call browser_observe first.`,
        );
      }
      await page.keyboard.type(target.value);
    },
    async press(key: string) {
      const page = await ensurePage();
      await page.keyboard.press(key);
    },
    async scroll(deltaY: number) {
      const page = await ensurePage();
      await page.mouse.wheel(0, deltaY);
    },
    async wait(waitOptions) {
      const page = await ensurePage();
      const timeout = Math.min(BROWSER_STEP_BUDGET_MS, waitOptions.ms ?? 5_000);
      if (waitOptions.text) {
        await page.getByText(waitOptions.text).first().waitFor({ state: "visible", timeout });
        return;
      }
      if (waitOptions.urlIncludes) {
        const needle = waitOptions.urlIncludes;
        await page.waitForURL((url) => url.toString().includes(needle), { timeout });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(timeout, 10_000)));
    },
    async close() {
      await context.close().catch(() => undefined);
    },
  };
}

interface ActiveAssistantBrowser {
  assistantId: string;
  homeDir: string;
  profileDir: string;
  downloadsDir: string;
  driver: BrowserSessionDriver;
  lastActiveAt: number;
}

export interface AssistantBrowserManagerOptions {
  now?: () => number;
  idleTimeoutMs?: number;
  hasPendingTakeover?: (assistantId: string) => boolean;
  driverFactory?: (options: {
    assistantId: string;
    homeDir: string;
    profileDir: string;
    downloadsDir: string;
  }) => Promise<BrowserSessionDriver>;
}

export class AssistantBrowserManager {
  private readonly sessions = new Map<string, ActiveAssistantBrowser>();
  private readonly now: () => number;
  private readonly idleTimeoutMs: number;
  private readonly hasPendingTakeover: (assistantId: string) => boolean;
  private readonly driverFactory: NonNullable<AssistantBrowserManagerOptions["driverFactory"]>;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AssistantBrowserManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.hasPendingTakeover = options.hasPendingTakeover ?? (() => false);
    this.driverFactory =
      options.driverFactory ??
      (({ profileDir, downloadsDir }) => createPlaywrightDriver({ profileDir, downloadsDir }));
    this.idleTimer = setInterval(
      () => void this.sweepIdle(),
      Math.min(60_000, Math.max(1_000, Math.floor(this.idleTimeoutMs / 2))),
    );
    this.idleTimer.unref();
  }

  isActive(assistantId: string): boolean {
    return this.sessions.has(assistantId);
  }

  getProfileDirectories(homeDir: string): { profileDir: string; downloadsDir: string } {
    const profileDir = path.join(homeDir, "browser-profile");
    const downloadsDir = path.join(homeDir, "downloads");
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    mkdirSync(downloadsDir, { recursive: true, mode: 0o700 });
    return { profileDir, downloadsDir };
  }

  private async ensureSession(
    assistantId: string,
    homeDir: string,
  ): Promise<ActiveAssistantBrowser> {
    const existing = this.sessions.get(assistantId);
    if (existing) {
      existing.lastActiveAt = this.now();
      return existing;
    }
    const { profileDir, downloadsDir } = this.getProfileDirectories(homeDir);
    const driver = await this.driverFactory({
      assistantId,
      homeDir,
      profileDir,
      downloadsDir,
    });
    const session: ActiveAssistantBrowser = {
      assistantId,
      homeDir,
      profileDir,
      downloadsDir,
      driver,
      lastActiveAt: this.now(),
    };
    this.sessions.set(assistantId, session);
    return session;
  }

  private async assertCurrentPageAllowedForMutation(
    session: ActiveAssistantBrowser,
    policy?: Partial<AssistantBrowserConfig>,
  ): Promise<void> {
    const currentUrl = await session.driver.currentUrl();
    if (!currentUrl || currentUrl === "about:blank") return;
    const check = checkBrowserUrlPolicy(currentUrl, policy, { mutating: true });
    if (!check.allowed) {
      if (check.decision === "ask") {
        throw new Error(
          `${check.reason} Call browser_hand_to_user so the user can review or complete this action.`,
        );
      }
      throw new Error(check.reason ?? `Action on "${currentUrl}" is not allowed.`);
    }
  }

  async open(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    url: string;
    includeScreenshot?: boolean;
  }): Promise<BrowserObservation> {
    assertBrowserUrlAllowed(input.url, input.policy, { mutating: false });
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    await session.driver.goto(input.url);
    const landedUrl = await session.driver.currentUrl();
    if (landedUrl && landedUrl !== "about:blank") {
      const landedCheck = checkBrowserUrlPolicy(landedUrl, input.policy, { mutating: false });
      if (!landedCheck.allowed) {
        await session.driver.goto("about:blank").catch(() => undefined);
        throw new Error(landedCheck.reason ?? `Redirected URL "${landedUrl}" is blocked.`);
      }
    }
    session.lastActiveAt = this.now();
    return this.observe({
      assistantId: input.assistantId,
      homeDir: input.homeDir,
      policy: input.policy,
      includeScreenshot: input.includeScreenshot,
    });
  }

  async tabs(input: {
    assistantId: string;
    homeDir: string;
    index?: number;
  }): Promise<{ tabs: BrowserTabInfo[] }> {
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    const tabs =
      input.index !== undefined
        ? await session.driver.selectTab(input.index)
        : await session.driver.tabs();
    session.lastActiveAt = this.now();
    return { tabs };
  }

  async closeTab(input: {
    assistantId: string;
    homeDir: string;
    index?: number;
  }): Promise<{ tabs: BrowserTabInfo[] }> {
    const existing = this.sessions.get(input.assistantId);
    if (!existing) return { tabs: [] };
    const tabs = await existing.driver.closeTab(input.index);
    existing.lastActiveAt = this.now();
    if (tabs.length === 0) {
      await this.stopAssistant(input.assistantId);
    }
    return { tabs };
  }

  async observe(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    includeScreenshot?: boolean;
  }): Promise<BrowserObservation> {
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    const raw = await session.driver.observe({
      includeScreenshot: input.includeScreenshot,
    });
    session.lastActiveAt = this.now();
    return redactBrowserObservation(raw);
  }

  async click(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    ref?: string;
    x?: number;
    y?: number;
    includeScreenshot?: boolean;
  }): Promise<BrowserObservation> {
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    await this.assertCurrentPageAllowedForMutation(session, input.policy);
    await session.driver.click({ ref: input.ref, x: input.x, y: input.y });
    session.lastActiveAt = this.now();
    return this.observe(input);
  }

  async fill(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    ref: string;
    value: string;
    includeScreenshot?: boolean;
  }): Promise<BrowserObservation> {
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    await this.assertCurrentPageAllowedForMutation(session, input.policy);
    await session.driver.fill({ ref: input.ref, value: input.value });
    session.lastActiveAt = this.now();
    return this.observe(input);
  }

  async press(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    key: string;
    includeScreenshot?: boolean;
  }): Promise<BrowserObservation> {
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    await this.assertCurrentPageAllowedForMutation(session, input.policy);
    await session.driver.press(input.key);
    session.lastActiveAt = this.now();
    return this.observe(input);
  }

  async scroll(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    deltaY?: number;
    includeScreenshot?: boolean;
  }): Promise<BrowserObservation> {
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    await session.driver.scroll(input.deltaY ?? 500);
    session.lastActiveAt = this.now();
    return this.observe(input);
  }

  async wait(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    text?: string;
    urlIncludes?: string;
    ms?: number;
    includeScreenshot?: boolean;
  }): Promise<BrowserObservation> {
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    await session.driver.wait({
      text: input.text,
      urlIncludes: input.urlIncludes,
      ms: input.ms,
    });
    session.lastActiveAt = this.now();
    return this.observe(input);
  }

  async steps(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    steps: BrowserStep[];
    includeScreenshot?: boolean;
  }): Promise<{ completedSteps: number; observation: BrowserObservation }> {
    if (input.steps.length < 1 || input.steps.length > 15) {
      throw new Error("browser_steps requires between 1 and 15 steps.");
    }
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    const startedAt = this.now();
    let completedSteps = 0;

    for (const step of input.steps) {
      if (this.now() - startedAt > BROWSER_STEP_BUDGET_MS) {
        throw new Error("browser_steps exceeded the 25s execution time budget.");
      }
      switch (step.action) {
        case "open": {
          assertBrowserUrlAllowed(step.url, input.policy, { mutating: false });
          await session.driver.goto(step.url);
          const landedUrl = await session.driver.currentUrl();
          if (landedUrl && landedUrl !== "about:blank") {
            assertBrowserUrlAllowed(landedUrl, input.policy, { mutating: false });
          }
          break;
        }
        case "click": {
          await this.assertCurrentPageAllowedForMutation(session, input.policy);
          await session.driver.click({ ref: step.ref, x: step.x, y: step.y });
          break;
        }
        case "fill": {
          await this.assertCurrentPageAllowedForMutation(session, input.policy);
          await session.driver.fill({ ref: step.ref, value: step.value });
          break;
        }
        case "press": {
          await this.assertCurrentPageAllowedForMutation(session, input.policy);
          await session.driver.press(step.key);
          break;
        }
        case "scroll": {
          await session.driver.scroll(step.deltaY ?? 500);
          break;
        }
        case "wait": {
          await session.driver.wait({
            text: step.text,
            urlIncludes: step.urlIncludes,
            ms: step.ms,
          });
          break;
        }
      }
      completedSteps += 1;
      session.lastActiveAt = this.now();
    }

    const observation = await this.observe({
      assistantId: input.assistantId,
      homeDir: input.homeDir,
      policy: input.policy,
      includeScreenshot: input.includeScreenshot,
    });
    return { completedSteps, observation };
  }

  async getPageState(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
  }): Promise<BrowserPageState> {
    const existing = this.sessions.get(input.assistantId);
    if (!existing) {
      return {
        active: false,
        url: null,
        title: null,
        screenshotDataUrl: null,
        elements: [],
      };
    }
    const observed = await this.observe({
      assistantId: input.assistantId,
      homeDir: input.homeDir,
      policy: input.policy,
      includeScreenshot: true,
    });
    return {
      active: true,
      url: observed.url,
      title: observed.title,
      screenshotDataUrl: observed.screenshotDataUrl,
      elements: observed.elements,
    };
  }

  async remoteAction(input: {
    assistantId: string;
    homeDir: string;
    policy?: Partial<AssistantBrowserConfig>;
    action: "goto" | "click" | "fill" | "press" | "scroll" | "reload";
    url?: string;
    ref?: string;
    x?: number;
    y?: number;
    value?: string;
    key?: string;
    deltaY?: number;
  }): Promise<BrowserPageState> {
    const session = await this.ensureSession(input.assistantId, input.homeDir);
    switch (input.action) {
      case "goto": {
        if (!input.url) throw new Error("URL is required for goto action.");
        assertBrowserUrlAllowed(input.url, input.policy, { mutating: false });
        await session.driver.goto(input.url);
        break;
      }
      case "reload": {
        await session.driver.reload();
        break;
      }
      case "click": {
        await session.driver.click({ ref: input.ref, x: input.x, y: input.y });
        break;
      }
      case "fill": {
        await session.driver.fill({ ref: input.ref, value: input.value ?? "" });
        break;
      }
      case "press": {
        await session.driver.press(input.key ?? "Enter");
        break;
      }
      case "scroll": {
        await session.driver.scroll(input.deltaY ?? 450);
        break;
      }
    }
    session.lastActiveAt = this.now();
    return this.getPageState({
      assistantId: input.assistantId,
      homeDir: input.homeDir,
      policy: input.policy,
    });
  }

  async sweepIdle(now = this.now()): Promise<string[]> {
    const closed: string[] = [];
    for (const [assistantId, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt < this.idleTimeoutMs) continue;
      if (this.hasPendingTakeover(assistantId)) continue;
      this.sessions.delete(assistantId);
      await session.driver.close().catch(() => undefined);
      closed.push(assistantId);
    }
    return closed;
  }

  async stopAssistant(assistantId: string): Promise<void> {
    const session = this.sessions.get(assistantId);
    if (!session) return;
    this.sessions.delete(assistantId);
    await session.driver.close().catch(() => undefined);
  }

  async stopAll(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(entries.map((entry) => entry.driver.close()));
  }
}
