import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../is-main-module.mjs";

export function createDevProfile(repoRoot, inheritedEnv) {
  const stateRoot = path.join(repoRoot, ".dev", "bigbang");
  const home = path.join(stateRoot, "paseo-home");
  const origins = [
    "http://localhost:8181",
    "http://127.0.0.1:8181",
    "http://localhost:8182",
    "http://127.0.0.1:8182",
  ];
  const env = {};
  for (const [key, value] of Object.entries(inheritedEnv)) {
    const isPaseoSetting = key.startsWith("PASEO_");
    const isExpoSetting = key.startsWith("EXPO_");
    if (!isPaseoSetting && !isExpoSetting && key !== "APP_VARIANT") env[key] = value;
  }
  const noProxyEntries = new Set(
    (inheritedEnv.NO_PROXY || inheritedEnv.no_proxy || "localhost,127.0.0.1,::1,0.0.0.0")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  noProxyEntries.add("100.107.11.10");
  noProxyEntries.add("100.72.105.59");
  const noProxy = [...noProxyEntries].join(",");
  Object.assign(env, {
    PASEO_HOME: home,
    PASEO_BIGBANG_BUILD: "1",
    PASEO_LISTEN: "127.0.0.1:6778",
    PASEO_DEV_DAEMON_ENDPOINT: "localhost:6778",
    PASEO_DEV_ROOT: stateRoot,
    PASEO_ELECTRON_USER_DATA_DIR: path.join(stateRoot, ".dev", "user-data"),
    PASEO_LOCAL_MODELS_DIR: path.join(stateRoot, "models"),
    PASEO_RELAY_ENABLED: "false",
    PASEO_CORS_ORIGINS: origins.join(","),
    EXPO_PUBLIC_BIGBANG: "true",
    APP_VARIANT: "bigbang",
    EXPO_PORT: "8181",
    BROWSER: "none",
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  });
  return { repoRoot, stateRoot, home, origins, env };
}

async function createPrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`Development state must be a real directory: ${directory}`);
  }
}

export async function prepareProfile(profile) {
  await createPrivateDirectory(path.join(profile.repoRoot, ".dev"));
  await createPrivateDirectory(profile.stateRoot);
  await createPrivateDirectory(profile.home);
  const configPath = path.join(profile.home, "config.json");
  const initialConfig = {
    version: 1,
    features: { dictation: { enabled: false }, voiceMode: { enabled: false } },
    daemon: {
      listen: profile.env.PASEO_LISTEN,
      relay: { enabled: false },
      mcp: { enabled: true, injectIntoAgents: true },
      cors: { allowedOrigins: profile.origins },
    },
  };
  try {
    await writeFile(configPath, `${JSON.stringify(initialConfig, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const entry = await lstat(configPath);
  if (entry.isSymbolicLink() || !entry.isFile())
    throw new Error("Development config must be a real file");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const matchesListen = config.daemon?.listen === profile.env.PASEO_LISTEN;
  const relayDisabled = config.daemon?.relay?.enabled === false;
  if (!matchesListen || !relayDisabled) {
    throw new Error(
      "Development config differs from the isolated profile; inspect it before launching",
    );
  }
}

export async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(port, "127.0.0.1", () => listener.close(resolve));
  });
}

async function main() {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const profile = createDevProfile(repoRoot, process.env);
  const [command = "profile", ...args] = process.argv.slice(2);
  if (command === "profile") {
    process.stdout.write(
      `${JSON.stringify({ home: profile.home, listen: profile.env.PASEO_LISTEN, web: "http://localhost:8181", desktopWeb: "http://localhost:8182", desktopUserData: profile.env.PASEO_ELECTRON_USER_DATA_DIR, relay: false }, null, 2)}\n`,
    );
    return;
  }
  const commands = {
    server: ["bash", ["scripts/dev-daemon.sh"]],
    app: ["bash", ["scripts/dev-app.sh", "--localhost"]],
    desktop: ["bash", ["packages/desktop/scripts/dev.sh"]],
    cli: [
      process.execPath,
      [
        "--conditions=source",
        "--import",
        "tsx",
        "packages/cli/src/index.js",
        "--home",
        profile.home,
        ...args,
      ],
    ],
  };
  const launch = commands[command];
  if (!Object.hasOwn(commands, command))
    throw new Error("Use profile, server, app, desktop, or cli");
  if (command === "cli" && args.some((arg) => /^--(home|host)(=|$)/.test(arg))) {
    throw new Error(
      "This CLI targets the Bigbang test daemon; use the normal CLI for another host",
    );
  }
  if (command !== "cli" && args.length > 0)
    throw new Error("Only cli accepts additional arguments");
  const ports = { server: 6778, app: 8181, desktop: 8182 };
  if (command !== "cli") await assertPortAvailable(ports[command]);
  process.umask(0o077);
  await prepareProfile(profile);
  if (command === "desktop") profile.env.EXPO_PORT = "8182";
  const child = spawn(launch[0], launch[1], { cwd: repoRoot, env: profile.env, stdio: "inherit" });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  child.on("error", (error) => {
    throw error;
  });
  child.on("exit", (code, signal) => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}

if (isMainModule(import.meta.url)) await main();
