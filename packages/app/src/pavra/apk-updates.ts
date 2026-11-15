export const PAVRA_GITHUB_REPO = "Oldpan/paseo";

export const AUTO_UPDATE_CHECK_INTERVAL_MS = 24 * 3600_000;
export const AUTO_UPDATE_RETRY_AFTER_FAILURE_MS = 4 * 3600_000;
export const REMOTE_UPDATE_CHECK_TIMEOUT_MS = 5_000;

export type PavraUpdateSource = "gh-proxy-manifest" | "github-manifest" | "github-api";

export interface GitHubReleaseAssetPayload {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  digest?: unknown;
}

export interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

export interface PavraUpdateManifestAssetPayload {
  name?: unknown;
  size?: unknown;
  sha256?: unknown;
  url?: unknown;
}

export interface PavraUpdateManifestPayload {
  schema?: unknown;
  version?: unknown;
  tag?: unknown;
  title?: unknown;
  publishedAt?: unknown;
  notes?: unknown;
  page?: unknown;
  revision?: unknown;
  assets?: {
    arm64?: PavraUpdateManifestAssetPayload;
  } | null;
}

export interface PavraApkReleaseInfo {
  tagName: string;
  title: string;
  version: string;
  revision: string | null;
  publishedAt: string | null;
  notes: string;
  apkDownloadUrl: string;
  apkFileName: string;
  apkSizeBytes: number | null;
  sha256: string | null;
  htmlUrl: string;
}

export interface InstalledPavraBuildInfo {
  version: string;
  revision: string | null;
  buildTime: string | null;
}

export function parseSemverTuple(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number {
  const tupleA = parseSemverTuple(a);
  const tupleB = parseSemverTuple(b);
  if (!tupleA || !tupleB) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (tupleA[i] !== tupleB[i]) {
      return tupleA[i] > tupleB[i] ? 1 : -1;
    }
  }
  return 0;
}

function extractVersionFromTag(tag: string): string | null {
  const match = tag.trim().match(/^(?:pavra-v|android-v|v)?(\d+\.\d+\.\d+)/i);
  return match ? match[1] : null;
}

function extractRevision(tag: string, body: string): string | null {
  const tagMatch = tag.trim().match(/^(?:pavra-v|android-v|v)\d+\.\d+\.\d+-([0-9a-f]{7,40})$/i);
  if (tagMatch) return tagMatch[1].slice(0, 9);
  const bodyMatch = body.match(/(?:commit|revision|sha)\**\s*[:=]\s*\**`?([0-9a-f]{7,40})`?/i);
  if (bodyMatch) return bodyMatch[1].slice(0, 9);
  return null;
}

export function extractSha256(assetDigest: string | null | undefined, body: string): string | null {
  if (typeof assetDigest === "string") {
    const digestMatch = assetDigest.trim().match(/^(?:sha256:)?([0-9a-f]{6,64})$/i);
    if (digestMatch) return digestMatch[1].toLowerCase();
  }
  if (typeof body === "string" && body.length > 0) {
    const bodyMatch = body.match(/sha-?256\**\s*[:=]\s*\**`?([0-9a-f]{6,64})`?/i);
    if (bodyMatch) return bodyMatch[1].toLowerCase();
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findApkAsset(rawAssets: unknown): {
  name: string;
  downloadUrl: string;
  sizeBytes: number | null;
  digest: string | null;
} | null {
  if (!Array.isArray(rawAssets)) return null;
  const assets = rawAssets as GitHubReleaseAssetPayload[];
  const picked =
    assets.find(
      (asset) =>
        typeof asset?.name === "string" &&
        /^pavra.*\.apk$/i.test(asset.name.trim()) &&
        typeof asset?.browser_download_url === "string",
    ) ??
    assets.find(
      (asset) =>
        typeof asset?.name === "string" &&
        asset.name.trim().toLowerCase().endsWith(".apk") &&
        typeof asset?.browser_download_url === "string",
    );
  if (!picked || typeof picked.browser_download_url !== "string") return null;
  return {
    name: nonEmptyString(picked.name) ?? "pavra-arm64.apk",
    downloadUrl: picked.browser_download_url.trim(),
    sizeBytes: positiveFiniteNumber(picked.size),
    digest: nonEmptyString(picked.digest),
  };
}

function resolveManifestVersionAndTag(record: PavraUpdateManifestPayload): {
  version: string;
  tagName: string;
} | null {
  const rawVersion = nonEmptyString(record.version);
  const rawTag = nonEmptyString(record.tag);
  const versionFromField = rawVersion ? extractVersionFromTag(rawVersion) : null;
  const versionFromTag = rawTag ? extractVersionFromTag(rawTag) : null;
  const version = versionFromField ?? versionFromTag;
  if (!version) return null;
  return {
    version,
    tagName: rawTag ?? `pavra-v${version}`,
  };
}

function resolveManifestArm64Asset(
  record: PavraUpdateManifestPayload,
): PavraUpdateManifestAssetPayload | null {
  if (!isPlainRecord(record.assets)) return null;
  const arm64 = record.assets.arm64;
  return isPlainRecord(arm64) ? (arm64 as PavraUpdateManifestAssetPayload) : null;
}

export function parsePavraUpdateManifest(payload: unknown): PavraApkReleaseInfo | null {
  if (!isPlainRecord(payload) || payload.schema !== 1) return null;
  const record = payload as PavraUpdateManifestPayload;

  const identity = resolveManifestVersionAndTag(record);
  const arm64 = resolveManifestArm64Asset(record);
  if (!identity || !arm64) return null;

  const downloadUrl = nonEmptyString(arm64.url);
  if (!downloadUrl) return null;

  const notes = nonEmptyString(record.notes) ?? "";
  const sha256 = extractSha256(nonEmptyString(arm64.sha256), notes);
  const revision =
    nonEmptyString(record.revision)?.slice(0, 9) ?? extractRevision(identity.tagName, notes);

  return {
    tagName: identity.tagName,
    title: nonEmptyString(record.title) ?? `Pavra v${identity.version}`,
    version: identity.version,
    revision,
    publishedAt: nonEmptyString(record.publishedAt),
    notes,
    apkDownloadUrl: downloadUrl,
    apkFileName: nonEmptyString(arm64.name) ?? "pavra-arm64.apk",
    apkSizeBytes: positiveFiniteNumber(arm64.size),
    sha256,
    htmlUrl:
      nonEmptyString(record.page) ??
      `https://github.com/${PAVRA_GITHUB_REPO}/releases/tag/${encodeURIComponent(identity.tagName)}`,
  };
}

export function parsePavraReleasePayload(
  payload: GitHubReleasePayload,
): PavraApkReleaseInfo | null {
  if (!payload || typeof payload !== "object" || payload.draft === true) return null;
  const tagName = nonEmptyString(payload.tag_name);
  if (!tagName || !/^(?:pavra-v|android-v|v)\d+\.\d+\.\d+/i.test(tagName)) return null;

  const apkAsset = findApkAsset(payload.assets);
  const version = extractVersionFromTag(tagName);
  if (!apkAsset || !version) return null;

  const body = nonEmptyString(payload.body) ?? "";
  return {
    tagName,
    title: nonEmptyString(payload.name) ?? `Pavra ${tagName}`,
    version,
    revision: extractRevision(tagName, body),
    publishedAt: nonEmptyString(payload.published_at),
    notes: body,
    apkDownloadUrl: apkAsset.downloadUrl,
    apkFileName: apkAsset.name,
    apkSizeBytes: apkAsset.sizeBytes,
    sha256: extractSha256(apkAsset.digest, body),
    htmlUrl:
      nonEmptyString(payload.html_url) ??
      `https://github.com/${PAVRA_GITHUB_REPO}/releases/tag/${encodeURIComponent(tagName)}`,
  };
}

export function isReleaseNewerThanInstalled(
  release: PavraApkReleaseInfo,
  installed: InstalledPavraBuildInfo,
): boolean {
  return compareSemver(release.version, installed.version) > 0;
}

export interface AutoUpdateCheckDueInput {
  nowMs?: number;
  lastCheckedAtMs: number | null | undefined;
  lastAttemptAtMs?: number | null | undefined;
  intervalMs?: number;
  retryAfterFailureMs?: number;
}

export function isAutoUpdateCheckDue(input: AutoUpdateCheckDueInput): boolean {
  const nowMs = finiteNumber(input.nowMs) ?? Date.now();
  const intervalMs = positiveFiniteNumber(input.intervalMs) ?? AUTO_UPDATE_CHECK_INTERVAL_MS;
  const retryAfterFailureMs =
    positiveFiniteNumber(input.retryAfterFailureMs) ?? AUTO_UPDATE_RETRY_AFTER_FAILURE_MS;

  const checkedAt = finiteNumber(input.lastCheckedAtMs);
  const attemptAt = finiteNumber(input.lastAttemptAtMs);

  // Backwards clock is always treated as due immediately.
  if ((checkedAt !== null && nowMs < checkedAt) || (attemptAt !== null && nowMs < attemptAt)) {
    return true;
  }

  // If the most recent attempt failed (or no check has succeeded yet), apply failure backoff.
  if (attemptAt !== null && (checkedAt === null || attemptAt > checkedAt)) {
    if (nowMs - attemptAt < retryAfterFailureMs) {
      return false;
    }
  }

  // If a check succeeded within the throttle interval, it is not due yet.
  if (checkedAt !== null && nowMs - checkedAt < intervalMs) {
    return false;
  }

  return true;
}

export interface UpdateCheckSourceDescriptor {
  source: PavraUpdateSource;
  url: string;
}

export function resolveUpdateCheckSources(options?: {
  repo?: string;
  lastWorkingSource?: PavraUpdateSource | string | null;
  preferredSource?: PavraUpdateSource | string | null;
}): UpdateCheckSourceDescriptor[] {
  const repo = nonEmptyString(options?.repo) ?? PAVRA_GITHUB_REPO;
  const preferred = nonEmptyString(options?.lastWorkingSource ?? options?.preferredSource);

  const manifestCandidates: UpdateCheckSourceDescriptor[] = [
    {
      source: "gh-proxy-manifest",
      url: `https://gh-proxy.com/https://github.com/${repo}/releases/latest/download/update.json`,
    },
    {
      source: "github-manifest",
      url: `https://github.com/${repo}/releases/latest/download/update.json`,
    },
  ];

  // Prioritize the last working manifest source first while keeping github-api strictly last.
  const orderedManifests: UpdateCheckSourceDescriptor[] = [];
  if (preferred && preferred !== "github-api") {
    for (const entry of manifestCandidates) {
      if (entry.source === preferred) {
        orderedManifests.push(entry);
      }
    }
  }
  for (const entry of manifestCandidates) {
    if (!orderedManifests.some((existing) => existing.url === entry.url)) {
      orderedManifests.push(entry);
    }
  }

  return [
    ...orderedManifests,
    {
      source: "github-api",
      url: `https://api.github.com/repos/${repo}/releases?per_page=10`,
    },
  ];
}

function parseFirstReleaseFromArray(items: unknown[]): PavraApkReleaseInfo | null {
  for (const item of items) {
    const parsed = parsePavraReleasePayload(item as GitHubReleasePayload);
    if (parsed) return parsed;
  }
  return null;
}

export interface FetchPavraApkReleaseOptions {
  repo?: string;
  lastWorkingSource?: PavraUpdateSource | string | null;
  preferredSource?: PavraUpdateSource | string | null;
  remoteTimeoutMs?: number;
  signal?: AbortSignal | null;
  fetchImpl?: typeof fetch;
  onSourceSuccess?: (source: PavraUpdateSource, url?: string) => void;
}

async function fetchSourceWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  externalSignal?: AbortSignal | null,
): Promise<Response> {
  if (externalSignal?.aborted) {
    throw new Error("Update check aborted");
  }
  if (typeof AbortController === "undefined") {
    return fetchFn(url, { headers });
  }
  const controller = new AbortController();
  const handleExternalAbort = () => {
    controller.abort();
  };
  externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const raceTimeout = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        if (externalSignal?.aborted) {
          reject(new Error("Update check aborted"));
          return;
        }
        reject(new Error(`Update check timed out after ${timeoutMs}ms`));
      },
      { once: true },
    );
  });

  try {
    return await Promise.race([
      fetchFn(url, {
        headers,
        signal: controller.signal,
      }),
      raceTimeout,
    ]);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  }
}

async function probeUpdateCheckSource(
  fetchFn: typeof fetch,
  entry: UpdateCheckSourceDescriptor,
  timeoutMs: number,
  externalSignal?: AbortSignal | null,
): Promise<{ release: PavraApkReleaseInfo | null; sawEmptyList: boolean }> {
  const response = await fetchSourceWithTimeout(
    fetchFn,
    entry.url,
    {
      Accept: entry.source === "github-api" ? "application/vnd.github+json" : "application/json",
    },
    timeoutMs,
    externalSignal,
  );
  if (!response.ok) {
    throw new Error(
      entry.source === "github-api"
        ? `GitHub release check failed (${response.status})`
        : `Update manifest check failed from ${entry.source} (${response.status})`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (entry.source === "github-api") {
    if (!Array.isArray(payload)) {
      return { release: null, sawEmptyList: false };
    }
    return { release: parseFirstReleaseFromArray(payload), sawEmptyList: true };
  }

  return { release: parsePavraUpdateManifest(payload), sawEmptyList: false };
}

function toCheckError(failure: unknown, source: string, signal?: AbortSignal | null): Error {
  if (signal?.aborted) {
    return failure instanceof Error ? failure : new Error("Update check aborted");
  }
  return failure instanceof Error ? failure : new Error(`Update check failed from ${source}`);
}

function resolveCheckTimeoutMs(options?: FetchPavraApkReleaseOptions): number {
  return positiveFiniteNumber(options?.remoteTimeoutMs) ?? REMOTE_UPDATE_CHECK_TIMEOUT_MS;
}

export async function fetchLatestPavraApkRelease(
  options?: FetchPavraApkReleaseOptions,
): Promise<PavraApkReleaseInfo | null> {
  const fetchFn = options?.fetchImpl ?? fetch;
  const sources = resolveUpdateCheckSources(options);
  const timeoutMs = resolveCheckTimeoutMs(options);
  const signal = options?.signal;

  let lastError: Error | null = null;
  let sawValidEmptyReleaseList = false;

  for (const entry of sources) {
    if (signal?.aborted) {
      throw new Error("Update check aborted");
    }
    try {
      const { release, sawEmptyList } = await probeUpdateCheckSource(
        fetchFn,
        entry,
        timeoutMs,
        signal,
      );
      if (sawEmptyList) sawValidEmptyReleaseList = true;
      if (release) {
        options?.onSourceSuccess?.(entry.source, entry.url);
        return release;
      }
    } catch (failure) {
      const err = toCheckError(failure, entry.source, signal);
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }

  if (sawValidEmptyReleaseList) return null;
  if (lastError) throw lastError;
  return null;
}

export interface BuildCandidateApkDownloadUrlsOptions {
  preferredSource?: PavraUpdateSource | string | null;
  lastWorkingSource?: PavraUpdateSource | string | null;
}

function resolvePreferredDownloadSource(
  preferredSourceOrOptions:
    | PavraUpdateSource
    | string
    | null
    | BuildCandidateApkDownloadUrlsOptions
    | undefined,
): string | null {
  if (typeof preferredSourceOrOptions === "string") {
    return nonEmptyString(preferredSourceOrOptions);
  }
  return nonEmptyString(
    preferredSourceOrOptions?.preferredSource ?? preferredSourceOrOptions?.lastWorkingSource,
  );
}

function deduplicateStrings(items: ReadonlyArray<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = nonEmptyString(item);
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

export function buildCandidateApkDownloadUrls(
  release: Pick<PavraApkReleaseInfo, "apkDownloadUrl"> & {
    apkFileName?: string | null;
    tagName?: string | null;
  },
  preferredSourceOrOptions?:
    | PavraUpdateSource
    | string
    | null
    | BuildCandidateApkDownloadUrlsOptions,
): string[] {
  const preferredSource = resolvePreferredDownloadSource(preferredSourceOrOptions);

  const rawDownloadUrl = nonEmptyString(release.apkDownloadUrl) ?? "";
  const directUrl = rawDownloadUrl.startsWith("https://gh-proxy.com/")
    ? rawDownloadUrl.slice("https://gh-proxy.com/".length)
    : rawDownloadUrl;
  const proxyUrl =
    directUrl.startsWith("https://") && !directUrl.startsWith("https://gh-proxy.com/")
      ? `https://gh-proxy.com/${directUrl}`
      : null;

  if (preferredSource === "github-manifest" || preferredSource === "github-api") {
    return deduplicateStrings([directUrl, proxyUrl]);
  }
  return deduplicateStrings([proxyUrl, directUrl]);
}

export function formatApkMegabytes(bytes: number | null | undefined): string | null {
  const validBytes = positiveFiniteNumber(bytes);
  if (validBytes === null) return null;
  return `${(validBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSha256Snippet(sha256: string | null | undefined): string | null {
  const clean = nonEmptyString(sha256);
  if (!clean) return null;
  if (clean.length <= 16) return clean;
  return `${clean.slice(0, 12)}…${clean.slice(-4)}`;
}
