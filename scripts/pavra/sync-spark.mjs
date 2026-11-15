import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../is-main-module.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultHost = process.env.PAVRA_SPARK_SSH ?? process.env.BIGBANG_SPARK_SSH ?? "OLDPAN-AI";
const defaultRemoteDir =
  process.env.PAVRA_SPARK_DIR ?? process.env.BIGBANG_SPARK_DIR ?? "/ai/code/paseo-bigbang";
const sparkNodeBin = "/home/linuxbrew/.linuxbrew/opt/node@24/bin";

function stageLocalUpdateManifestsForWebUi() {
  const artifactsDir = path.join(repoRoot, "artifacts");
  const webUiUpdatesDir = path.join(
    repoRoot,
    "packages",
    "server",
    "dist",
    "server",
    "web-ui",
    "updates",
  );
  const candidateFiles = ["update.json", "SHA256SUMS", "pavra-arm64.apk"];
  const copiedFiles = [];

  for (const fileName of candidateFiles) {
    const sourcePath = path.join(artifactsDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }
    mkdirSync(webUiUpdatesDir, { recursive: true });
    const destinationPath = path.join(webUiUpdatesDir, fileName);
    copyFileSync(sourcePath, destinationPath);
    copiedFiles.push(fileName);
  }

  return { webUiUpdatesDir, copiedFiles };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

async function syncOnce({ all, reloadPlugin, rebuildWebUi }) {
  const target = `${defaultHost}:${defaultRemoteDir.replace(/\/$/, "")}/`;
  const stagedUpdates = stageLocalUpdateManifestsForWebUi();
  const excludes = [
    "--exclude=.git/",
    "--exclude=.dev/",
    "--exclude=node_modules/",
    "--exclude=dist/",
    "--exclude=.expo/",
    "--exclude=*.tsbuildinfo",
  ];

  if (all) {
    await run("rsync", ["-az", "--delete", ...excludes, "./", target]);
  } else {
    await run("rsync", [
      "-az",
      "--delete",
      ...excludes,
      "extensions/pavra/",
      `${target}extensions/pavra/`,
    ]);
    await run("rsync", [
      "-az",
      "--delete",
      ...excludes,
      "packages/app/src/pavra/",
      `${target}packages/app/src/pavra/`,
    ]);
  }

  if (reloadPlugin) {
    await run("npm", ["run", "pavra:cli", "--", "plugin", "reload", "pavra"]);
    await run("ssh", [
      defaultHost,
      `cd ${defaultRemoteDir} && PATH="${sparkNodeBin}:$PATH" npm run pavra:cli -- plugin reload pavra`,
    ]);
  }

  if (rebuildWebUi) {
    await run("ssh", [
      defaultHost,
      `cd ${defaultRemoteDir} && PATH="${sparkNodeBin}:$PATH" npm run pavra:build:daemon-web-ui`,
    ]);
    stageLocalUpdateManifestsForWebUi();
  }

  if (stagedUpdates.copiedFiles.length > 0) {
    await run("rsync", [
      "-az",
      "packages/server/dist/server/web-ui/updates/",
      `${target}packages/server/dist/server/web-ui/updates/`,
    ]);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const all = args.has("--all");
  const reloadPlugin = !args.has("--no-reload");
  const rebuildWebUi = args.has("--web-ui");
  const watchMode = args.has("--watch");

  await syncOnce({ all, reloadPlugin, rebuildWebUi });

  if (!watchMode) {
    return;
  }

  let timer = null;
  let running = false;
  let queued = false;

  const trigger = () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    syncOnce({ all: false, reloadPlugin, rebuildWebUi: false })
      .catch((error) => {
        process.stderr.write(`[pavra:sync-spark] ${error.message}\n`);
      })
      .finally(() => {
        running = false;
        if (queued) {
          queued = false;
          trigger();
        }
      });
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(trigger, 300);
  };

  const watchedDirs = [
    path.join(repoRoot, "extensions", "pavra"),
    path.join(repoRoot, "packages", "app", "src", "pavra"),
  ];
  for (const dir of watchedDirs) {
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename || filename.endsWith(".tsbuildinfo")) return;
      schedule();
    });
  }
  process.stdout.write(
    `[pavra:sync-spark] watching extensions/pavra and packages/app/src/pavra -> ${defaultHost}:${defaultRemoteDir}\n`,
  );
}

if (isMainModule(import.meta.url)) {
  await main();
}
