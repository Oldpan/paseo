import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, "packages/app/package.json"), "utf8"));
const apkPath = path.join(root, "artifacts/pavra-arm64.apk");
const repo = process.env.PAVRA_GITHUB_REPO ?? "Oldpan/paseo";

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");

function runInherit(command, commandArgs, envOverrides = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, ...envOverrides },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

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
const version = String(pkg.version ?? "0.15.3").trim();
const tagName = process.env.PAVRA_RELEASE_TAG ?? `pavra-v${version}-${shortSha}`;
const title = `Pavra ${version} (${shortSha})`;

const apkBytes = readFileSync(apkPath);
const sha256 = createHash("sha256").update(apkBytes).digest("hex");
const sizeMb = (statSync(apkPath).size / (1024 * 1024)).toFixed(1);

const notes = [
  `## Pavra Android ARM64 Release`,
  `- **Version**: \`${version}\``,
  `- **Commit**: \`${shortSha}\``,
  `- **Size**: ${sizeMb} MB`,
  `- **SHA-256**: \`${sha256}\``,
].join("\n");

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
    "--title",
    title,
    "--notes",
    notes,
    "--repo",
    repo,
  ]);
}

console.log(
  `\nPublished Pavra APK release: https://github.com/${repo}/releases/tag/${tagName}\nDirect APK: https://github.com/${repo}/releases/download/${tagName}/pavra-arm64.apk\n`,
);
