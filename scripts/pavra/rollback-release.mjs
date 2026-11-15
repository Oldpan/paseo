import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../is-main-module.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const versionFilePath = path.join(root, "packages/app/src/pavra/version.json");
const extensionPkgPath = path.join(root, "extensions/pavra/package.json");
const defaultRepo = process.env.PAVRA_GITHUB_REPO ?? "Oldpan/paseo";

export function parseRollbackTargetVersion(rawTarget) {
  const trimmed = String(rawTarget ?? "").trim();
  const match = /^(?:pavra-v|android-v|v)?(\d+\.\d+\.\d+)(?:-[0-9a-z.-]+)?$/i.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid rollback target "${rawTarget}". Expected a semver version (e.g. 0.15.3) or tag (e.g. pavra-v0.15.3).`,
    );
  }
  const version = match[1];
  const tagName = /^pavra-v/i.test(trimmed) ? trimmed : `pavra-v${version}`;
  return { version, tagName };
}

export function listPavraReleaseTags(cwd = root) {
  const output = execFileSync("git", ["tag", "-l", "pavra-v*", "--sort=-v:refname"], {
    cwd,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolvePreviousPavraRelease(currentVersion, tags) {
  const normalizedCurrent = String(currentVersion ?? "")
    .trim()
    .replace(/^v/i, "");
  for (const tag of tags) {
    try {
      const parsed = parseRollbackTargetVersion(tag);
      if (parsed.version !== normalizedCurrent) {
        return { version: parsed.version, tagName: tag };
      }
    } catch {
      // Ignore non-standard tags.
    }
  }
  if (tags.length >= 2) {
    return parseRollbackTargetVersion(tags[1]);
  }
  if (tags.length === 1) {
    return parseRollbackTargetVersion(tags[0]);
  }
  throw new Error(
    "No previous pavra-v* git tags found. Pass --to <version|tag> explicitly (e.g. --to 0.15.3).",
  );
}

export function parseRollbackArgs(argv) {
  let target = "";
  let dryRun = false;
  let execute = false;
  let currentbadTag = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--to") {
      target = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg?.startsWith("--to=")) {
      target = arg.slice("--to=".length);
      continue;
    }
    if (arg === "--retire-tag") {
      currentbadTag = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--execute") {
      execute = true;
      continue;
    }
  }

  return { target, dryRun, execute, retireTag: currentbadTag };
}

function runCommandInherit(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status ?? 1}`);
  }
}

export function applyVersionFiles(targetVersion) {
  writeFileSync(
    versionFilePath,
    `${JSON.stringify({ version: targetVersion }, null, 2)}\n`,
    "utf8",
  );
  const extensionPkg = JSON.parse(readFileSync(extensionPkgPath, "utf8"));
  extensionPkg.version = targetVersion;
  writeFileSync(extensionPkgPath, `${JSON.stringify(extensionPkg, null, 2)}\n`, "utf8");
}

function main() {
  const { target, dryRun, execute, retireTag } = parseRollbackArgs(process.argv.slice(2));
  const currentData = JSON.parse(readFileSync(versionFilePath, "utf8"));
  const currentVersion = String(currentData.version ?? "0.16.0").trim();
  const tags = listPavraReleaseTags(root);

  const resolved = target
    ? parseRollbackTargetVersion(target)
    : resolvePreviousPavraRelease(currentVersion, tags);

  const matchingTag =
    tags.find((tag) => tag === resolved.tagName) ??
    tags.find((tag) => tag.startsWith(`pavra-v${resolved.version}`)) ??
    resolved.tagName;
  const badReleaseTag = retireTag || `pavra-v${currentVersion}`;

  if (dryRun) {
    console.log(
      `[dry-run] Would roll back Pavra version: ${currentVersion} -> ${resolved.version} (${matchingTag})`,
    );
  } else {
    applyVersionFiles(resolved.version);
    console.log(
      `Rolled back Pavra version files: ${currentVersion} -> ${resolved.version} (target tag: ${matchingTag})`,
    );
    console.log("  - packages/app/src/pavra/version.json");
    console.log("  - extensions/pavra/package.json");
  }

  const steps = [
    `\nRollback Playbook (Spark web-ui & GitHub Release):`,
    `  1. Sync Spark coordinator plugin & rebuild Spark web-ui (:6778):`,
    `     npm run pavra:sync-spark -- --web-ui`,
    `  2. Demote or mark the rolled-back GitHub Release (${badReleaseTag}) as prerelease / draft:`,
    `     gh release edit ${badReleaseTag} --prerelease --repo ${defaultRepo}`,
    `  3. Ensure target GitHub Release (${matchingTag}) is marked latest for Settings APK updater:`,
    `     gh release edit ${matchingTag} --latest --repo ${defaultRepo}`,
  ];
  console.log(steps.join("\n"));

  if (execute && !dryRun) {
    console.log("\nExecuting Spark plugin + web-ui rollback sync...");
    runCommandInherit("npm", ["run", "pavra:sync-spark", "--", "--web-ui"]);
    if (badReleaseTag !== matchingTag) {
      spawnSync("gh", ["release", "edit", badReleaseTag, "--prerelease", "--repo", defaultRepo], {
        cwd: root,
        stdio: "inherit",
      });
    }
    spawnSync("gh", ["release", "edit", matchingTag, "--latest", "--repo", defaultRepo], {
      cwd: root,
      stdio: "inherit",
    });
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
