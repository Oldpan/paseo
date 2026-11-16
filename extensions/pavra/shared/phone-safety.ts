export const PHONE_PASSWORD_MASK = "••••";
export const PHONE_REDACTED_ID = "[REDACTED_ID]";
export const PHONE_REDACTED_CARD = "[REDACTED_CARD]";

export const phoneOutwardConfirmTierValues = [
  "always_ask",
  "once_per_task",
  "always_allow",
] as const;
export type PhoneOutwardConfirmTier = (typeof phoneOutwardConfirmTierValues)[number];

export interface PhoneUiBoundsLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PhoneUiElementLike {
  ref?: string;
  id?: string;
  index?: number;
  text?: string;
  contentDescription?: string;
  hint?: string;
  className?: string;
  resourceId?: string;
  packageName?: string;
  bounds?: PhoneUiBoundsLike;
  x?: number;
  y?: number;
  clickable?: boolean;
  editable?: boolean;
  scrollable?: boolean;
  checkable?: boolean;
  checked?: boolean;
  focused?: boolean;
  enabled?: boolean;
  password?: boolean;
  isPassword?: boolean;
}

export interface PhoneObservationLike {
  deviceId?: string;
  displayId?: number | null;
  packageName: string;
  appName?: string;
  activityName?: string | null;
  isSecureFlag?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  treeQuality?: "good" | "sparse" | "empty";
  summary?: string;
  elements: PhoneUiElementLike[];
  screenshotBase64?: string | null;
  screenshotMimeType?: "image/jpeg" | "image/png";
  lastTapX?: number | null;
  lastTapY?: number | null;
  capturedAt?: number;
}

export type BlockedPhonePackageCategory =
  | "banking_finance"
  | "system_permission"
  | "lockscreen"
  | "self_app";

export interface PhonePackagePolicyOptions {
  unlockedPackages?: readonly string[];
  activityName?: string | null;
}

export interface PhonePackageCheckResult {
  blocked: boolean;
  category?: BlockedPhonePackageCategory;
  reason?: string;
}

const HARD_BLOCKED_FINANCE_PACKAGES: ReadonlySet<string> = new Set([
  "com.icbc",
  "com.icbc.im",
  "com.chinamworld.main",
  "com.chinamworld.bocmbci",
  "com.android.bankabc",
  "com.cmbchina.ccd.pluto.cmbactivity",
  "com.bankcomm.bankcomm",
  "com.yitong.mbank.psbc",
  "com.pingan.paces.ccms",
  "com.citiccard.mobilebank",
  "com.ecitic.bank.mobile",
  "com.cebbank.mobile.cemb",
  "com.cmbc.cc.mbank",
  "com.spdbccc.app",
  "cn.com.spdb.mobilebank.per",
  "com.cib.cibmb",
  "com.unionpay",
  "com.eg.android.alipaygphone",
  "com.paypal.android.p2pmobile",
  "com.stripe.android.dashboard",
  "com.coinbase.android",
  "com.binance.dev",
  "com.hexin.plat.android",
  "com.eastmoney.android.berlin",
  "com.lphtsccft",
  "com.gtja.junhong",
  "com.hundsun.winner.pazq",
  "com.futu.futubull",
  "com.tigerbrokers.stock",
  "com.robinhood.android",
  "com.schwab.mobile",
]);

const HARD_BLOCKED_FINANCE_PREFIXES: readonly string[] = [
  "com.icbc.",
  "com.cmbchina.",
  "com.chinamworld.",
  "com.pingan.paces.",
];

const SYSTEM_PERMISSION_PACKAGES: ReadonlySet<string> = new Set([
  "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
  "com.android.packageinstaller",
  "com.google.android.packageinstaller",
  "com.miui.securitycenter",
  "com.coloros.safecenter",
  "com.huawei.systemmanager",
  "com.android.vpndialogs",
  "com.android.certinstaller",
]);

const SELF_APP_PACKAGES: ReadonlySet<string> = new Set([
  "com.oldpan.pavra",
  "com.oldpan.pavra.debug",
  "app.paseo",
  "app.paseo.dogfood",
  "dev.paseo.app",
]);

const SOCIAL_OUTWARD_PACKAGES: ReadonlySet<string> = new Set([
  "com.tencent.mm",
  "com.xingin.xhs",
  "com.tencent.mobileqq",
  "com.sina.weibo",
  "com.ss.android.ugc.aweme",
  "com.alibaba.android.rimet",
  "com.ss.android.lark",
  "com.larksuite.suite",
  "com.android.mms",
  "com.google.android.apps.messaging",
  "com.samsung.android.messaging",
  "com.whatsapp",
  "org.telegram.messenger",
  "com.discord",
  "com.slack",
  "com.twitter.android",
  "com.instagram.android",
]);

const PAYMENT_CONFIRMATION_PATTERNS: readonly RegExp[] = [
  /立即支付/,
  /确认支付/,
  /确认转账/,
  /立即转账/,
  /确认付款/,
  /立即付款/,
  /免密支付/,
  /输入密码/,
  /请输入支付密码/,
  /请输入交易密码/,
  /指纹支付/,
  /面容支付/,
  /塞钱进红包/,
  /\bpay\s+now\b/i,
  /\bconfirm\s+payment\b/i,
  /\bconfirm\s+transfer\b/i,
  /\bauthorize\s+payment\b/i,
];

const PAYMENT_ACTIVITY_PATTERN =
  /cashier|wallet.*pay|pay.*activity|walletpayui|checkout.*pay|收银台/i;

const OUTWARD_SEND_LABEL_PATTERN =
  /^(发送|发布|发消息|发笔记|发表|立即发布|提交|转发|群发|回复|send|post|publish|reply|tweet)$/i;

const OUTWARD_SEND_RESOURCE_PATTERN =
  /(?:^|\/|:)(?:send_btn|btn_send|publish_btn|btn_publish|post_btn|compose_send)(?:$|_)/i;

// 18-digit Chinese Resident ID: 6-digit region ([1-8]\d{5}) + YYYYMMDD (19xx/20xx) + 3 digits + check char ([0-9Xx]).
const CN_RESIDENT_ID_REGEX =
  /(?<!\d)[1-8]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dXx])/g;

// 16-19 digit bank card numbers (contiguous or separated by single spaces/hyphens).
const BANK_CARD_CANDIDATE_REGEX = /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g;

function normalizePackageName(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeUnlockedSet(
  options?: PhonePackagePolicyOptions | readonly string[],
): Set<string> {
  const list = Array.isArray(options)
    ? options
    : (options as PhonePackagePolicyOptions | undefined)?.unlockedPackages;
  const set = new Set<string>();
  if (!list) return set;
  for (const item of list) {
    const clean = normalizePackageName(item);
    if (clean) set.add(clean);
  }
  return set;
}

export function checkPhonePackagePolicy(
  packageName: string,
  options?: PhonePackagePolicyOptions | readonly string[],
): PhonePackageCheckResult {
  const normalized = normalizePackageName(packageName);
  if (!normalized) return { blocked: false };

  const unlocked = normalizeUnlockedSet(options);
  if (unlocked.has(normalized)) {
    return { blocked: false };
  }

  const activityName = !Array.isArray(options)
    ? ((options as PhonePackagePolicyOptions | undefined)?.activityName ?? null)
    : null;

  if (
    HARD_BLOCKED_FINANCE_PACKAGES.has(normalized) ||
    HARD_BLOCKED_FINANCE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    normalized.includes(".mobilebank") ||
    normalized.includes(".mbank")
  ) {
    return {
      blocked: true,
      category: "banking_finance",
      reason: `Package "${packageName}" is a hard-locked banking, payment, or securities app and cannot be controlled by an assistant.`,
    };
  }

  if (
    SYSTEM_PERMISSION_PACKAGES.has(normalized) ||
    (normalized === "com.android.settings" &&
      Boolean(activityName && /lock|password|biometric|deviceadmin|credential/i.test(activityName)))
  ) {
    return {
      blocked: true,
      category: "system_permission",
      reason: `Package "${packageName}" is a system permission or security controller and is locked.`,
    };
  }

  if (
    normalized === "com.android.keyguard" ||
    normalized === "com.android.systemui:keyguard" ||
    normalized === "com.android.systemui"
  ) {
    return {
      blocked: true,
      category: "lockscreen",
      reason: `Package "${packageName}" is the system lockscreen/keyguard and cannot be operated by an assistant.`,
    };
  }

  if (SELF_APP_PACKAGES.has(normalized)) {
    return {
      blocked: true,
      category: "self_app",
      reason: `Package "${packageName}" is Pavra/Paseo itself and is locked against self-modification unless explicitly unlocked.`,
    };
  }

  return { blocked: false };
}

export function isBlockedPhonePackage(
  packageName: string,
  options?: PhonePackagePolicyOptions | readonly string[],
): boolean {
  return checkPhonePackagePolicy(packageName, options).blocked;
}

function normalizeElementRef(ref: string): string {
  const trimmed = ref.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function findPhoneElementByRef(
  elements: readonly PhoneUiElementLike[],
  ref?: string | null,
): PhoneUiElementLike | null {
  if (!ref) return null;
  const target = normalizeElementRef(ref);
  const plain = target.slice(1);
  for (const el of elements) {
    const candidateRef = el.ref ? normalizeElementRef(el.ref) : null;
    const candidateId = el.id ? normalizeElementRef(el.id) : null;
    if (candidateRef === target || candidateId === target || el.ref === plain || el.id === plain) {
      return el;
    }
  }
  return null;
}

function elementLabelText(element: PhoneUiElementLike | null | undefined): string {
  if (!element) return "";
  return [element.text, element.contentDescription, element.hint].filter(Boolean).join(" ").trim();
}

export function isPasswordPhoneElement(element: PhoneUiElementLike | null | undefined): boolean {
  if (!element) return false;
  return element.password === true || element.isPassword === true;
}

function matchesPaymentText(text: string): string | null {
  if (!text) return null;
  for (const pattern of PAYMENT_CONFIRMATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export function isOutwardSocialAction(input: {
  packageName: string;
  action: string;
  targetElement?: PhoneUiElementLike | null;
  submit?: boolean;
}): boolean {
  const pkg = normalizePackageName(input.packageName);
  if (!SOCIAL_OUTWARD_PACKAGES.has(pkg)) return false;
  if (input.action === "type" && input.submit === true) return true;
  if (input.action !== "tap") return false;
  const element = input.targetElement;
  if (!element) return false;
  const label = (element.text ?? element.contentDescription ?? "").trim();
  if (label && OUTWARD_SEND_LABEL_PATTERN.test(label)) return true;
  if (element.resourceId && OUTWARD_SEND_RESOURCE_PATTERN.test(element.resourceId)) return true;
  return false;
}

export type PhoneSafetyDecision = "allow" | "deny" | "require_takeover" | "require_confirmation";

export interface PhoneSafetyGateInput {
  action:
    | "observe"
    | "tap"
    | "type"
    | "scroll"
    | "swipe"
    | "back"
    | "launch_app"
    | "intent"
    | "clipboard"
    | "steps"
    | "collect";
  observation?: PhoneObservationLike | null;
  targetPackageName?: string;
  targetElement?: PhoneUiElementLike | null;
  targetRef?: string;
  submit?: boolean;
  unlockedPackages?: readonly string[];
  outwardConfirmTier?: PhoneOutwardConfirmTier;
  taskConfirmedPackages?: ReadonlySet<string> | readonly string[];
  confirmedAction?: boolean;
}

export interface PhoneSafetyGateResult {
  decision: PhoneSafetyDecision;
  category?: "blocked_package" | "secure_flag" | "payment" | "password" | "outward_social";
  reason?: string;
}

function hasConfirmedPackage(
  collection: ReadonlySet<string> | readonly string[] | undefined,
  packageName: string,
): boolean {
  if (!collection) return false;
  const normalized = normalizePackageName(packageName);
  if (Array.isArray(collection)) {
    return collection.some((item) => normalizePackageName(item) === normalized);
  }
  if ((collection as ReadonlySet<string>).has(normalized)) return true;
  for (const item of collection) {
    if (normalizePackageName(item) === normalized) return true;
  }
  return false;
}

function findObservationPaymentMatch(observation: PhoneObservationLike | null): string | null {
  if (!observation) return null;
  if (observation.summary) {
    const fromSummary = matchesPaymentText(observation.summary);
    if (fromSummary) return fromSummary;
  }
  for (const el of observation.elements) {
    const matched = matchesPaymentText(elementLabelText(el));
    if (matched) return matched;
  }
  return null;
}

function evaluatePaymentOrPasswordTrigger(
  input: PhoneSafetyGateInput,
  observation: PhoneObservationLike | null,
  targetElement: PhoneUiElementLike | null,
): PhoneSafetyGateResult | null {
  if (observation?.isSecureFlag === true) {
    return {
      decision: "require_takeover",
      category: "secure_flag",
      reason:
        "Current screen sets FLAG_SECURE (payment, password, or protected content). Handing control to the user on the phone.",
    };
  }

  if (
    (input.action === "tap" || input.action === "type") &&
    isPasswordPhoneElement(targetElement)
  ) {
    return {
      decision: "require_takeover",
      category: "password",
      reason:
        "Password or PIN input field detected. Handing control to the user to enter credentials directly on the phone.",
    };
  }

  const targetPaymentKeyword = matchesPaymentText(elementLabelText(targetElement));
  if (targetPaymentKeyword) {
    return {
      decision: "require_takeover",
      category: "payment",
      reason: `Payment or password confirmation control ("${targetPaymentKeyword}") detected. Payments must be confirmed directly by the user on the phone.`,
    };
  }

  const activityName = observation?.activityName ?? null;
  if (activityName && PAYMENT_ACTIVITY_PATTERN.test(activityName)) {
    return {
      decision: "require_takeover",
      category: "payment",
      reason: `Payment cashier screen ("${activityName}") detected. Handing control to the user on the phone.`,
    };
  }

  const screenPaymentKeyword = findObservationPaymentMatch(observation);
  if (screenPaymentKeyword) {
    return {
      decision: "require_takeover",
      category: "payment",
      reason: `Payment confirmation screen ("${screenPaymentKeyword}") detected. Payments must be confirmed by the user on the phone.`,
    };
  }

  return null;
}

function evaluateOutwardTierDecision(
  input: PhoneSafetyGateInput,
  packageName: string,
): PhoneSafetyGateResult {
  const tier: PhoneOutwardConfirmTier = input.outwardConfirmTier ?? "always_ask";
  if (tier === "always_allow") {
    return { decision: "allow", category: "outward_social" };
  }
  if (tier === "once_per_task") {
    const confirmed =
      input.confirmedAction === true ||
      hasConfirmedPackage(input.taskConfirmedPackages, packageName);
    if (confirmed) {
      return { decision: "allow", category: "outward_social" };
    }
    return {
      decision: "require_confirmation",
      category: "outward_social",
      reason: `Outward social send/publish action in "${packageName}" requires user confirmation once per task.`,
    };
  }
  if (input.confirmedAction === true) {
    return { decision: "allow", category: "outward_social" };
  }
  return {
    decision: "require_confirmation",
    category: "outward_social",
    reason: `Outward social send/publish action in "${packageName}" requires explicit user confirmation ("always_ask").`,
  };
}

export function evaluatePhoneSafetyGate(input: PhoneSafetyGateInput): PhoneSafetyGateResult {
  const observation = input.observation ?? null;
  const packageName = input.targetPackageName ?? observation?.packageName ?? "";

  if (packageName) {
    const pkgCheck = checkPhonePackagePolicy(packageName, {
      unlockedPackages: input.unlockedPackages,
      activityName: observation?.activityName ?? null,
    });
    if (pkgCheck.blocked) {
      return {
        decision: "deny",
        category: "blocked_package",
        reason: pkgCheck.reason,
      };
    }
  }

  const targetElement =
    input.targetElement ??
    (observation ? findPhoneElementByRef(observation.elements, input.targetRef) : null);

  const takeoverTrigger = evaluatePaymentOrPasswordTrigger(input, observation, targetElement);
  if (takeoverTrigger) {
    return takeoverTrigger;
  }

  if (
    packageName &&
    isOutwardSocialAction({
      packageName,
      action: input.action,
      targetElement,
      submit: input.submit,
    })
  ) {
    return evaluateOutwardTierDecision(input, packageName);
  }

  return { decision: "allow" };
}

export function redactPhoneUiTreeText(text: string): string {
  if (!text) return text;
  const idRedacted = text.replace(CN_RESIDENT_ID_REGEX, PHONE_REDACTED_ID);
  return idRedacted.replace(BANK_CARD_CANDIDATE_REGEX, (match) => {
    const digitsOnly = match.replace(/\D/g, "");
    if (digitsOnly.length >= 16 && digitsOnly.length <= 19) {
      return PHONE_REDACTED_CARD;
    }
    return match;
  });
}

export function sanitizePhoneObservation<T extends PhoneObservationLike>(observation: T): T {
  const sanitizedElements = observation.elements.map((element) => {
    const passwordNode = isPasswordPhoneElement(element);
    const next: PhoneUiElementLike = {
      ...element,
    };
    if (passwordNode) {
      next.text = PHONE_PASSWORD_MASK;
    } else if (typeof element.text === "string") {
      next.text = redactPhoneUiTreeText(element.text);
    }
    if (typeof element.contentDescription === "string") {
      next.contentDescription = redactPhoneUiTreeText(element.contentDescription);
    }
    if (typeof element.hint === "string") {
      next.hint = redactPhoneUiTreeText(element.hint);
    }
    return next;
  });

  return {
    ...observation,
    ...(typeof observation.summary === "string"
      ? { summary: redactPhoneUiTreeText(observation.summary) }
      : {}),
    elements: sanitizedElements,
  };
}
