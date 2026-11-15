export const PAVRA_GITHUB_REPO = "Oldpan/paseo";

export interface GitHubReleaseAssetPayload {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
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
  const match = tag.trim().match(/^(?:pavra-v|android-v|v)(\d+\.\d+\.\d+)/i);
  return match ? match[1] : null;
}

function extractRevision(tag: string, body: string): string | null {
  const tagMatch = tag.trim().match(/^(?:pavra-v|android-v|v)\d+\.\d+\.\d+-([0-9a-f]{7,40})$/i);
  if (tagMatch) return tagMatch[1].slice(0, 9);
  const bodyMatch = body.match(/(?:commit|revision|sha)\s*[:=]\s*`?([0-9a-f]{7,40})`?/i);
  if (bodyMatch) return bodyMatch[1].slice(0, 9);
  return null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function findApkAsset(rawAssets: unknown): {
  name: string;
  downloadUrl: string;
  sizeBytes: number | null;
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
    sizeBytes: typeof picked.size === "number" && Number.isFinite(picked.size) ? picked.size : null,
  };
}

export function parsePavraReleasePayload(
  payload: GitHubReleasePayload,
): PavraApkReleaseInfo | null {
  if (!payload || typeof payload !== "object" || payload.draft === true) return null;
  const tagName = nonEmptyString(payload.tag_name);
  if (!tagName) return null;

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
    htmlUrl:
      nonEmptyString(payload.html_url) ??
      `https://github.com/${PAVRA_GITHUB_REPO}/releases/tag/${encodeURIComponent(tagName)}`,
  };
}

export function isReleaseNewerThanInstalled(
  release: PavraApkReleaseInfo,
  installed: InstalledPavraBuildInfo,
): boolean {
  const semverDiff = compareSemver(release.version, installed.version);
  if (semverDiff > 0) return true;
  if (semverDiff < 0) return false;

  if (release.revision && installed.revision) {
    if (
      release.revision.startsWith(installed.revision) ||
      installed.revision.startsWith(release.revision)
    ) {
      return false;
    }
    if (release.publishedAt && installed.buildTime) {
      const releaseMs = Date.parse(release.publishedAt);
      const installedMs = Date.parse(installed.buildTime);
      if (Number.isFinite(releaseMs) && Number.isFinite(installedMs)) {
        return releaseMs > installedMs + 60_000;
      }
    }
    return true;
  }

  if (release.publishedAt && installed.buildTime) {
    const releaseMs = Date.parse(release.publishedAt);
    const installedMs = Date.parse(installed.buildTime);
    if (Number.isFinite(releaseMs) && Number.isFinite(installedMs)) {
      return releaseMs > installedMs + 60_000;
    }
  }

  return false;
}

export async function fetchLatestPavraApkRelease(options?: {
  repo?: string;
  fetchImpl?: typeof fetch;
}): Promise<PavraApkReleaseInfo | null> {
  const repo = options?.repo ?? PAVRA_GITHUB_REPO;
  const fetchFn = options?.fetchImpl ?? fetch;
  const response = await fetchFn(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status})`);
  }
  const items = (await response.json()) as unknown;
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    const parsed = parsePavraReleasePayload(item as GitHubReleasePayload);
    if (parsed) return parsed;
  }
  return null;
}
