import { describe, expect, it, vi } from "vitest";
import extensionPkg from "../../../../extensions/pavra/package.json";
import { readCoordinatorVersion } from "../../../../extensions/pavra/index.server";
import pavraVersion from "./version.json";
import { EMPTY_CHAT_STATE, mergeChatState } from "./model";
import {
  compareSemver,
  fetchLatestPavraApkRelease,
  isReleaseNewerThanInstalled,
  parsePavraReleasePayload,
  parseSemverTuple,
} from "./apk-updates";

describe("apk-updates", () => {
  it("parses semver tuples and compares versions", () => {
    expect(parseSemverTuple("0.15.3")).toEqual([0, 15, 3]);
    expect(parseSemverTuple("v1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(compareSemver("0.15.4", "0.15.3")).toBe(1);
    expect(compareSemver("0.15.3", "0.15.3")).toBe(0);
    expect(compareSemver("0.15.2", "0.15.3")).toBe(-1);
  });

  it("parses a GitHub release payload with a Pavra APK asset", () => {
    const parsed = parsePavraReleasePayload({
      tag_name: "pavra-v0.15.3-1600619d6",
      name: "Pavra 0.15.3 (1600619d6)",
      body: "Commit: 1600619d6\nSHA-256: abcdef",
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
      notes: "Commit: 1600619d6\nSHA-256: abcdef",
      apkDownloadUrl:
        "https://github.com/Oldpan/paseo/releases/download/pavra-v0.15.3-1600619d6/pavra-arm64.apk",
      apkFileName: "pavra-arm64.apk",
      apkSizeBytes: 169869312,
      htmlUrl: "https://github.com/Oldpan/paseo/releases/tag/pavra-v0.15.3-1600619d6",
    });
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
    // When GitHub release is rolled back to 0.15.3, an installed 0.16.0 client does not prompt a newer update,
    // while an older 0.15.2 client still upgrades to the 0.15.3 target.
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

  it("fetches and returns the first release with an APK asset", async () => {
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

  it("keeps client version.json and coordinator package.json aligned at 0.16.0 and preserves coordinatorVersion in chat.state", () => {
    expect(pavraVersion.version).toBe("0.16.0");
    expect(extensionPkg.version).toBe(pavraVersion.version);
    expect(readCoordinatorVersion(".dev/pavra/paseo-home")).toBe("0.16.0");

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
