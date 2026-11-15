import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pavraVersionPath = path.join(root, "packages/app/src/pavra/version.json");
const appPkgPath = path.join(root, "packages/app/package.json");
const versionSource = existsSync(pavraVersionPath)
  ? JSON.parse(readFileSync(pavraVersionPath, "utf8"))
  : JSON.parse(readFileSync(appPkgPath, "utf8"));
const artifactsDir = path.join(root, "artifacts");
const apkPath = path.join(artifactsDir, "pavra-arm64.apk");
const updateJsonPath = path.join(artifactsDir, "update.json");
const sha256SumsPath = path.join(artifactsDir, "SHA256SUMS");
const repo = process.env.PAVRA_GITHUB_REPO?.trim() || "Oldpan/paseo";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const skipBuild = args.has("--skip-build");
const manifestOnly = args.has("--manifest-only");
const noUpload = args.has("--no-upload");

function parseTagArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tag" && typeof argv[i + 1] === "string") {
      return argv[i + 1].trim();
    }
    if (arg.startsWith("--tag=")) {
      return arg.slice("--tag=".length).trim();
    }
  }
  return "";
}

function runInherit(command, commandArgs, envOverrides = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, ...envOverrides },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function extractSha256FromRelease(releaseInfo, apkAsset) {
  if (typeof apkAsset?.digest === "string") {
    const digestMatch = /^sha256:([a-f0-9]{64})$/i.exec(apkAsset.digest.trim());
    if (digestMatch) {
      return digestMatch[1].toLowerCase();
    }
  }
  if (typeof releaseInfo?.body === "string") {
    const bodyMatch = /SHA-256\**:\s*`?([a-f0-9]{64})`?/i.exec(releaseInfo.body);
    if (bodyMatch) {
      return bodyMatch[1].toLowerCase();
    }
  }
  if (existsSync(apkPath)) {
    return createHash("sha256").update(readFileSync(apkPath)).digest("hex");
  }
  throw new Error(
    `Could not determine APK SHA-256 from release ${releaseInfo?.tagName ?? ""} or local ${apkPath}`,
  );
}

function resolveApkSizeBytes(apkAsset) {
  if (typeof apkAsset?.size === "number" && apkAsset.size > 0) {
    return apkAsset.size;
  }
  if (existsSync(apkPath)) {
    return statSync(apkPath).size;
  }
  return 0;
}

function writeReleaseManifests({
  version,
  tagName,
  title,
  publishedAt,
  notes,
  pageUrl,
  sizeBytes,
  sha256,
  downloadUrl,
}) {
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(sha256SumsPath, `${sha256}  pavra-arm64.apk\n`, "utf8");
  const manifest = {
    schema: 1,
    version,
    tag: tagName,
    title,
    publishedAt,
    notes,
    page: pageUrl,
    assets: {
      arm64: {
        name: "pavra-arm64.apk",
        size: sizeBytes,
        sha256,
        url: downloadUrl,
      },
    },
  };
  writeFileSync(updateJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

const configuredVersion = String(versionSource.version ?? "0.16.0").trim();
const requestedTag =
  parseTagArg(rawArgs) || process.env.PAVRA_RELEASE_TAG?.trim() || `pavra-v${configuredVersion}`;

if (manifestOnly) {
  const releaseJsonText = execFileSync(
    "gh",
    [
      "release",
      "view",
      requestedTag,
      "--repo",
      repo,
      "--json",
      "tagName,name,publishedAt,createdAt,body,url,assets",
    ],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  const releaseInfo = JSON.parse(releaseJsonText);
  const tagName = String(releaseInfo.tagName || requestedTag).trim();
  const version = tagName.startsWith("pavra-v")
    ? tagName.slice("pavra-v".length)
    : configuredVersion;
  const title = String(releaseInfo.name || `Pavra v${version}`).trim();
  const publishedAt = String(
    releaseInfo.publishedAt || releaseInfo.createdAt || new Date().toISOString(),
  ).trim();
  const apkAsset = Array.isArray(releaseInfo.assets)
    ? (releaseInfo.assets.find((asset) => asset?.name === "pavra-arm64.apk") ??
      releaseInfo.assets.find(
        (asset) => typeof asset?.name === "string" && asset.name.endsWith(".apk"),
      ))
    : undefined;
  const sha256 = extractSha256FromRelease(releaseInfo, apkAsset);
  const sizeBytes = resolveApkSizeBytes(apkAsset);
  if (!sizeBytes) {
    throw new Error(`Could not determine APK byte size for release ${tagName}`);
  }
  const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
  const pageUrl = String(
    releaseInfo.url || `https://github.com/${repo}/releases/tag/${tagName}`,
  ).trim();
  const downloadUrl = String(
    apkAsset?.url || `https://github.com/${repo}/releases/download/${tagName}/pavra-arm64.apk`,
  ).trim();
  const notes =
    typeof releaseInfo.body === "string" && releaseInfo.body.trim().length > 0
      ? releaseInfo.body
      : [
          `## Pavra v${version} (Android ARM64)`,
          `- **Version**: \`${version}\``,
          `- **Size**: ${sizeMb} MB`,
          `- **SHA-256**: \`${sha256}\``,
        ].join("\n");

  writeReleaseManifests({
    version,
    tagName,
    title,
    publishedAt,
    notes,
    pageUrl,
    sizeBytes,
    sha256,
    downloadUrl,
  });

  if (!noUpload) {
    console.log(`Uploading update.json and SHA256SUMS to GitHub release ${tagName} on ${repo}...`);
    runInherit("gh", [
      "release",
      "upload",
      tagName,
      `${updateJsonPath}#update.json`,
      `${sha256SumsPath}#SHA256SUMS`,
      "--clobber",
      "--repo",
      repo,
    ]);
  }

  console.log(
    `\nGenerated Pavra release manifests for ${tagName}:\n- ${updateJsonPath}\n- ${sha256SumsPath}\n`,
  );
} else {
  if (!skipBuild || !existsSync(apkPath)) {
    console.log("Building Pavra ARM64 release APK...");
    runInherit("npm", ["run", "pavra:apk:arm64"]);
  }

  if (!existsSync(apkPath)) {
    throw new Error(`APK artifact not found at ${apkPath}`);
  }

  const shortSha = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const tagName = requestedTag;
  const version = tagName.startsWith("pavra-v")
    ? tagName.slice("pavra-v".length)
    : configuredVersion;
  const title = `Pavra v${version}`;

  const apkBytes = readFileSync(apkPath);
  const sizeBytes = statSync(apkPath).size;
  const sha256 = createHash("sha256").update(apkBytes).digest("hex");
  const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
  const publishedAt = new Date().toISOString();
  const pageUrl = `https://github.com/${repo}/releases/tag/${tagName}`;
  const downloadUrl = `https://github.com/${repo}/releases/download/${tagName}/pavra-arm64.apk`;

  const notes = [
    `## Pavra v${version} (Android ARM64)`,
    `- **Version**: \`${version}\``,
    `- **Commit**: \`${shortSha}\``,
    `- **Size**: ${sizeMb} MB`,
    `- **SHA-256**: \`${sha256}\``,
  ].join("\n");

  writeReleaseManifests({
    version,
    tagName,
    title,
    publishedAt,
    notes,
    pageUrl,
    sizeBytes,
    sha256,
    downloadUrl,
  });

  if (!noUpload) {
    const releaseExists =
      spawnSync("gh", ["release", "view", tagName, "--repo", repo], {
        cwd: root,
        stdio: "ignore",
      }).status === 0;

    if (releaseExists) {
      console.log(`Updating existing GitHub release ${tagName} on ${repo}...`);
      runInherit("gh", [
        "release",
        "upload",
        tagName,
        `${apkPath}#pavra-arm64.apk`,
        `${updateJsonPath}#update.json`,
        `${sha256SumsPath}#SHA256SUMS`,
        "--clobber",
        "--repo",
        repo,
      ]);
      runInherit("gh", [
        "release",
        "edit",
        tagName,
        "--title",
        title,
        "--notes",
        notes,
        "--repo",
        repo,
      ]);
    } else {
      console.log(`Creating GitHub release ${tagName} on ${repo}...`);
      runInherit("gh", [
        "release",
        "create",
        tagName,
        `${apkPath}#pavra-arm64.apk`,
        `${updateJsonPath}#update.json`,
        `${sha256SumsPath}#SHA256SUMS`,
        "--title",
        title,
        "--notes",
        notes,
        "--repo",
        repo,
      ]);
    }
  }

  console.log(
    `\nPublished Pavra APK release: ${pageUrl}\nDirect APK: ${downloadUrl}\nUpdate manifest: https://github.com/${repo}/releases/download/${tagName}/update.json\nSHA256SUMS: https://github.com/${repo}/releases/download/${tagName}/SHA256SUMS\n`,
  );
}
