import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../is-main-module.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultHost = process.env.BIGBANG_SPARK_SSH ?? "OLDPAN-AI";
const defaultRemoteDir = process.env.BIGBANG_SPARK_DIR ?? "/ai/code/paseo-bigbang";
const sparkNodeBin = "/home/linuxbrew/.linuxbrew/opt/node@24/bin";

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
      "extensions/bigbang/",
      `${target}extensions/bigbang/`,
    ]);
    await run("rsync", [
      "-az",
      "--delete",
      ...excludes,
      "packages/app/src/bigbang/",
      `${target}packages/app/src/bigbang/`,
    ]);
  }

  if (reloadPlugin) {
    await run("npm", ["run", "bigbang:cli", "--", "plugin", "reload", "bigbang"]);
    await run("ssh", [
      defaultHost,
      `cd ${defaultRemoteDir} && PATH="${sparkNodeBin}:$PATH" npm run bigbang:cli -- plugin reload bigbang`,
    ]);
  }

  if (rebuildWebUi) {
    await run("ssh", [
      defaultHost,
      `cd ${defaultRemoteDir} && PATH="${sparkNodeBin}:$PATH" npm run bigbang:build:daemon-web-ui`,
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
        process.stderr.write(`[bigbang:sync-spark] ${error.message}\n`);
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
    path.join(repoRoot, "extensions", "bigbang"),
    path.join(repoRoot, "packages", "app", "src", "bigbang"),
  ];
  for (const dir of watchedDirs) {
    watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename || filename.endsWith(".tsbuildinfo")) return;
      schedule();
    });
  }
  process.stdout.write(
    `[bigbang:sync-spark] watching extensions/bigbang and packages/app/src/bigbang -> ${defaultHost}:${defaultRemoteDir}\n`,
  );
}

if (isMainModule(import.meta.url)) {
  await main();
}
