import { describe, expect, it, vi } from "vitest";
import extensionPkg from "../../../../extensions/pavra/package.json";
import { readCoordinatorVersion } from "../../../../extensions/pavra/index.server";
import pavraVersion from "./version.json";
import { EMPTY_CHAT_STATE, mergeChatState } from "./model";
import {
  buildCandidateApkDownloadUrls,
  compareSemver,
  fetchLatestPavraApkRelease,
  formatApkMegabytes,
  formatSha256Snippet,
  isAutoUpdateCheckDue,
  isReleaseNewerThanInstalled,
  parsePavraReleasePayload,
  parsePavraUpdateManifest,
  parseSemverTuple,
  resolveUpdateCheckSources,
} from "./apk-updates";

describe("apk-updates", () => {
  it("parses semver tuples and compares versions", () => {
    expect(parseSemverTuple("0.15.3")).toEqual([0, 15, 3]);
    expect(parseSemverTuple("v1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(compareSemver("0.15.4", "0.15.3")).toBe(1);
    expect(compareSemver("0.15.3", "0.15.3")).toBe(0);
    expect(compareSemver("0.15.2", "0.15.3")).toBe(-1);
  });

  it("parses a GitHub release payload with a Pavra APK asset and extracts sha256 from body or digest", () => {
    const parsed = parsePavraReleasePayload({
      tag_name: "pavra-v0.15.3-1600619d6",
      name: "Pavra 0.15.3 (1600619d6)",
      body: "Commit: 1600619d6\nSHA-256: `abcdef012345`",
      draft: false,
      published_at: "2026-11-15T08:30:00Z",
      html_url: "https://github.com/Oldpan/paseo/releases/tag/pavra-v0.15.3-1600619d6",
      assets: [
        {
          name: "pavra-arm64.apk",
          browser_download_url:
            "https://github.com/Oldpan/paseo/releases/download/pavra-v0.15.3-1600619d6/pavra-arm64.apk",
          size: 169869312,
        },
      ],
    });
    expect(parsed).toEqual({
      tagName: "pavra-v0.15.3-1600619d6",
      title: "Pavra 0.15.3 (1600619d6)",
      version: "0.15.3",
      revision: "1600619d6",
      publishedAt: "2026-11-15T08:30:00Z",
      notes: "Commit: 1600619d6\nSHA-256: `abcdef012345`",
      apkDownloadUrl:
        "https://github.com/Oldpan/paseo/releases/download/pavra-v0.15.3-1600619d6/pavra-arm64.apk",
      apkFileName: "pavra-arm64.apk",
      apkSizeBytes: 169869312,
      sha256: "abcdef012345",
      htmlUrl: "https://github.com/Oldpan/paseo/releases/tag/pavra-v0.15.3-1600619d6",
    });

    const fromDigest = parsePavraReleasePayload({
      tag_name: "pavra-v0.16.0",
      name: "Pavra v0.16.0",
      body: "- **Commit**: `a1631d5f9`",
      draft: false,
      published_at: "2026-11-15T12:00:00Z",
      assets: [
        {
          name: "pavra-arm64.apk",
          browser_download_url:
            "https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
          size: 170600000,
          digest: "sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
        },
      ],
    });
    expect(fromDigest?.sha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(fromDigest?.revision).toBe("a1631d5f9");
  });

  it("parses update.json (schema 1) manifest and rejects unsupported schemas", () => {
    const manifest = {
      schema: 1,
      version: "0.16.0",
      tag: "pavra-v0.16.0",
      title: "Pavra v0.16.0",
      publishedAt: "2026-11-15T13:00:00Z",
      notes: "## Pavra v0.16.0\n- **Commit**: `a1631d5f9`",
      page: "https://github.com/Oldpan/paseo/releases/tag/pavra-v0.16.0",
      assets: {
        arm64: {
          name: "pavra-arm64.apk",
          size: 170601234,
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          url: "https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
        },
      },
    };
    const parsed = parsePavraUpdateManifest(manifest);
    expect(parsed).toEqual({
      tagName: "pavra-v0.16.0",
      title: "Pavra v0.16.0",
      version: "0.16.0",
      revision: "a1631d5f9",
      publishedAt: "2026-11-15T13:00:00Z",
      notes: "## Pavra v0.16.0\n- **Commit**: `a1631d5f9`",
      apkDownloadUrl:
        "https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
      apkFileName: "pavra-arm64.apk",
      apkSizeBytes: 170601234,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      htmlUrl: "https://github.com/Oldpan/paseo/releases/tag/pavra-v0.16.0",
    });

    expect(parsePavraUpdateManifest({ ...manifest, schema: 2 })).toBeNull();
    expect(parsePavraUpdateManifest({ ...manifest, assets: {} })).toBeNull();
    expect(parsePavraUpdateManifest(null)).toBeNull();
    expect(parsePavraUpdateManifest([])).toBeNull();
  });

  it("detects updates strictly by higher semver version", () => {
    const release = parsePavraReleasePayload({
      tag_name: "pavra-v0.16.0",
      body: "Commit: 999999999",
      published_at: "2026-11-15T10:00:00Z",
      assets: [
        {
          name: "pavra-arm64.apk",
          browser_download_url: "https://example.com/pavra-arm64.apk",
        },
      ],
    })!;
    expect(
      isReleaseNewerThanInstalled(release, {
        version: "0.15.3",
        revision: "1600619d6",
        buildTime: "2026-11-15T08:00:00Z",
      }),
    ).toBe(true);
    expect(
      isReleaseNewerThanInstalled(release, {
        version: "0.16.0",
        revision: "1600619d6",
        buildTime: "2026-11-15T08:00:00Z",
      }),
    ).toBe(false);
    expect(
      isReleaseNewerThanInstalled(release, {
        version: "0.16.1",
        revision: "1600619d6",
        buildTime: "2026-11-15T08:00:00Z",
      }),
    ).toBe(false);
  });

  it("compares semver across patch, minor, major, and rollback versions", () => {
    // Patch progression & rollback
    expect(compareSemver("0.15.4", "0.15.3")).toBe(1);
    expect(compareSemver("0.15.3", "0.15.4")).toBe(-1);

    // Minor progression & rollback (0.15.3 <-> 0.16.0)
    expect(compareSemver("0.16.0", "0.15.3")).toBe(1);
    expect(compareSemver("0.15.3", "0.16.0")).toBe(-1);

    // Major progression & rollback (0.16.0 <-> 1.0.0)
    expect(compareSemver("1.0.0", "0.16.0")).toBe(1);
    expect(compareSemver("0.16.0", "1.0.0")).toBe(-1);

    const rolledBackRelease = parsePavraReleasePayload({
      tag_name: "pavra-v0.15.3-3194eb2b6",
      body: "Commit: 3194eb2b6",
      published_at: "2026-11-15T08:00:00Z",
      assets: [
        {
          name: "pavra-arm64.apk",
          browser_download_url: "https://example.com/pavra-arm64.apk",
        },
      ],
    })!;
    expect(
      isReleaseNewerThanInstalled(rolledBackRelease, {
        version: "0.16.0",
        revision: "a1631d5f9",
        buildTime: "2026-11-15T12:00:00Z",
      }),
    ).toBe(false);
    expect(
      isReleaseNewerThanInstalled(rolledBackRelease, {
        version: "0.15.2",
        revision: "111111111",
        buildTime: "2026-11-14T12:00:00Z",
      }),
    ).toBe(true);
  });

  it("evaluates isAutoUpdateCheckDue with 24h success throttle, 4h failure backoff, and backwards clock handling", () => {
    const nowMs = 1_760_000_000_000;
    const hourMs = 3600_000;

    // Never checked before -> due
    expect(
      isAutoUpdateCheckDue({
        nowMs,
        lastCheckedAtMs: null,
        lastAttemptAtMs: null,
      }),
    ).toBe(true);

    // Checked 12h ago (within 24h throttle) -> not due
    expect(
      isAutoUpdateCheckDue({
        nowMs,
        lastCheckedAtMs: nowMs - 12 * hourMs,
        lastAttemptAtMs: nowMs - 12 * hourMs,
      }),
    ).toBe(false);

    // Checked exactly 24h ago -> due
    expect(
      isAutoUpdateCheckDue({
        nowMs,
        lastCheckedAtMs: nowMs - 24 * hourMs,
        lastAttemptAtMs: nowMs - 24 * hourMs,
      }),
    ).toBe(true);

    // Checked 30h ago, but failed attempt 2h ago (within 4h failure backoff) -> not due
    expect(
      isAutoUpdateCheckDue({
        nowMs,
        lastCheckedAtMs: nowMs - 30 * hourMs,
        lastAttemptAtMs: nowMs - 2 * hourMs,
      }),
    ).toBe(false);

    // Checked 30h ago, failed attempt 5h ago (past 4h failure backoff) -> due
    expect(
      isAutoUpdateCheckDue({
        nowMs,
        lastCheckedAtMs: nowMs - 30 * hourMs,
        lastAttemptAtMs: nowMs - 5 * hourMs,
      }),
    ).toBe(true);

    // Never succeeded, failed attempt 1h ago -> not due
    expect(
      isAutoUpdateCheckDue({
        nowMs,
        lastCheckedAtMs: null,
        lastAttemptAtMs: nowMs - 1 * hourMs,
      }),
    ).toBe(false);

    // Backwards system clock -> treated as due
    expect(
      isAutoUpdateCheckDue({
        nowMs,
        lastCheckedAtMs: nowMs + 10_000,
        lastAttemptAtMs: null,
      }),
    ).toBe(true);
    expect(
      isAutoUpdateCheckDue({
        nowMs,
        lastCheckedAtMs: null,
        lastAttemptAtMs: nowMs + 10_000,
      }),
    ).toBe(true);
  });

  it("orders multi-source check descriptors with lastWorkingSource first, gh-proxy before raw github, and github-api always last", () => {
    expect(resolveUpdateCheckSources().map((s) => s.source)).toEqual([
      "gh-proxy-manifest",
      "github-manifest",
      "github-api",
    ]);

    expect(
      resolveUpdateCheckSources({
        lastWorkingSource: "github-manifest",
      }).map((s) => s.source),
    ).toEqual(["github-manifest", "gh-proxy-manifest", "github-api"]);

    // github-api stays last even if it was the last working source
    expect(
      resolveUpdateCheckSources({
        lastWorkingSource: "github-api",
      }).map((s) => s.source),
    ).toEqual(["gh-proxy-manifest", "github-manifest", "github-api"]);
  });

  it("falls back across sources, enforces per-source timeout, and reports the working source", async () => {
    const calledUrls: string[] = [];
    const onSourceSuccess = vi.fn();
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      calledUrls.push(url);
      if (url.startsWith("https://gh-proxy.com/")) {
        // Simulate a hanging mirror that never resolves unless timed out
        return new Promise(() => {});
      }
      if (url.startsWith("https://github.com/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schema: 1,
            version: "0.16.0",
            tag: "pavra-v0.16.0",
            title: "Pavra v0.16.0",
            publishedAt: "2026-11-15T13:00:00Z",
            notes: "GitHub manifest release",
            page: "https://github.com/Oldpan/paseo/releases/tag/pavra-v0.16.0",
            assets: {
              arm64: {
                name: "pavra-arm64.apk",
                size: 170000000,
                sha256: "1234567890abcdef",
                url: "https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
              },
            },
          }),
        };
      }
      return { ok: false, status: 500, json: async () => [] };
    });

    const latest = await fetchLatestPavraApkRelease({
      remoteTimeoutMs: 25,
      fetchImpl: mockFetch as unknown as typeof fetch,
      onSourceSuccess,
    });

    expect(calledUrls).toEqual([
      "https://gh-proxy.com/https://github.com/Oldpan/paseo/releases/latest/download/update.json",
      "https://github.com/Oldpan/paseo/releases/latest/download/update.json",
    ]);
    expect(onSourceSuccess).toHaveBeenCalledWith(
      "github-manifest",
      "https://github.com/Oldpan/paseo/releases/latest/download/update.json",
    );
    expect(latest?.version).toBe("0.16.0");
    expect(latest?.sha256).toBe("1234567890abcdef");
  });

  it("fetches and returns the first release with an APK asset via github-api fallback", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tag_name: "v0.15.3", draft: true, assets: [] },
        {
          tag_name: "pavra-v0.15.3-1600619d6",
          draft: false,
          assets: [
            {
              name: "pavra-arm64.apk",
              browser_download_url: "https://example.com/pavra-arm64.apk",
            },
          ],
        },
      ],
    });
    const latest = await fetchLatestPavraApkRelease({
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(latest?.tagName).toBe("pavra-v0.15.3-1600619d6");
  });

  it("builds ordered candidate APK download URLs based on preferredSource", () => {
    const release = {
      tagName: "pavra-v0.16.0",
      apkFileName: "pavra-arm64.apk",
      apkDownloadUrl:
        "https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
    };

    expect(buildCandidateApkDownloadUrls(release, null)).toEqual([
      "https://gh-proxy.com/https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
      "https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
    ]);

    expect(buildCandidateApkDownloadUrls(release, "gh-proxy-manifest")).toEqual([
      "https://gh-proxy.com/https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
      "https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
    ]);

    expect(buildCandidateApkDownloadUrls(release, "github-manifest")).toEqual([
      "https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
      "https://gh-proxy.com/https://github.com/Oldpan/paseo/releases/download/pavra-v0.16.0/pavra-arm64.apk",
    ]);
  });

  it("formats APK sizes and SHA-256 snippets", () => {
    expect(formatApkMegabytes(170_603_315)).toBe("162.7 MB");
    expect(formatApkMegabytes(null)).toBeNull();
    expect(
      formatSha256Snippet("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
    ).toBe("e3b0c44298fc…b855");
  });

  it("keeps client version.json and coordinator package.json aligned and preserves coordinatorVersion in chat.state", () => {
    expect(pavraVersion.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(extensionPkg.version).toBe(pavraVersion.version);
    expect(readCoordinatorVersion(".dev/pavra/paseo-home")).toBe(pavraVersion.version);

    const snapshot = mergeChatState(EMPTY_CHAT_STATE, {
      ...EMPTY_CHAT_STATE,
      generation: "gen-1",
      cursor: 1,
      coordinatorVersion: "0.16.0",
    });
    expect(snapshot.coordinatorVersion).toBe("0.16.0");

    const incremental = mergeChatState(snapshot, {
      ...EMPTY_CHAT_STATE,
      generation: "gen-1",
      cursor: 2,
    });
    expect(incremental.coordinatorVersion).toBe("0.16.0");
  });
});
