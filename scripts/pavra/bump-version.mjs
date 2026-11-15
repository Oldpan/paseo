import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const versionFilePath = path.join(root, "packages/app/src/pavra/version.json");
const extensionPkgPath = path.join(root, "extensions/pavra/package.json");

function parseArgs(argv) {
  let mode = "";
  let commitAndTag = false;
  let push = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      mode = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--commit-and-tag") {
      commitAndTag = true;
      continue;
    }
    if (arg === "--push") {
      push = true;
      continue;
    }
  }

  if (!["patch", "minor", "major"].includes(mode)) {
    throw new Error(
      "Usage: node scripts/pavra/bump-version.mjs --mode <patch|minor|major> [--commit-and-tag] [--push]",
    );
  }

  return { mode, commitAndTag, push };
}

function bumpSemver(version, mode) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(`Invalid Pavra semver version: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (mode === "major") return `${major + 1}.0.0`;
  if (mode === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const { mode, commitAndTag, push } = parseArgs(process.argv.slice(2));
const currentData = JSON.parse(readFileSync(versionFilePath, "utf8"));
const currentVersion = String(currentData.version ?? "0.15.3").trim();
const nextVersion = bumpSemver(currentVersion, mode);

writeFileSync(versionFilePath, `${JSON.stringify({ version: nextVersion }, null, 2)}\n`, "utf8");
const extensionPkg = JSON.parse(readFileSync(extensionPkgPath, "utf8"));
extensionPkg.version = nextVersion;
writeFileSync(extensionPkgPath, `${JSON.stringify(extensionPkg, null, 2)}\n`, "utf8");
console.log(`Bumped Pavra version: ${currentVersion} -> ${nextVersion}`);

if (commitAndTag) {
  const tagName = `pavra-v${nextVersion}`;
  execFileSync(
    "git",
    ["add", "packages/app/src/pavra/version.json", "extensions/pavra/package.json"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  execFileSync("git", ["commit", "-m", `chore(pavra): release v${nextVersion}`], {
    cwd: root,
    stdio: "inherit",
  });
  execFileSync("git", ["tag", "-a", tagName, "-m", `Pavra v${nextVersion}`], {
    cwd: root,
    stdio: "inherit",
  });
  console.log(`Created git tag ${tagName}`);

  if (push) {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["push", "origin", branch, tagName], {
      cwd: root,
      stdio: "inherit",
    });
    console.log(`Pushed ${branch} and ${tagName} to origin.`);
  }
}
