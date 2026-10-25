import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");

function assertNoDirectWorkerLaunch(label, command) {
  for (const workerEntrypoint of [
    "src/server/index.ts",
    "dist/server/server/index.js",
    "src/server/daemon-worker.ts",
    "dist/server/server/daemon-worker.js",
  ]) {
    assert.ok(
      !command.includes(workerEntrypoint),
      `${label} must not launch ${workerEntrypoint} directly: ${command}`,
    );
  }
}

function assertNoSpawnedWorkerEntrypoint(label, source) {
  assertNoDirectWorkerLaunch(label, source);
  assert.doesNotMatch(
    source,
    /spawn\([^)]*["'`][^"'`]*\.\.\/index\.ts["'`]/s,
    `${label} must not spawn ../index.ts directly`,
  );
}

test("every executable daemon entrypoint enters the supervisor", async () => {
  const [
    serverPackageSource,
    appIsolatedHostDaemon,
    serverConnectionOfferE2e,
    desktopRuntimePaths,
    nixPackage,
    nixModule,
  ] = await Promise.all([
    readFile(join(repoRoot, "packages/server/package.json"), "utf8"),
    readFile(join(repoRoot, "packages/app/e2e/support/helpers/isolated-host-daemon.ts"), "utf8"),
    readFile(
      join(repoRoot, "packages/server/src/server/daemon-e2e/connection-offer.e2e.test.ts"),
      "utf8",
    ),
    readFile(join(repoRoot, "packages/desktop/src/daemon/runtime-paths.ts"), "utf8"),
    readFile(join(repoRoot, "nix/package.nix"), "utf8"),
    readFile(join(repoRoot, "nix/module.nix"), "utf8"),
  ]);

  const serverPackage = JSON.parse(serverPackageSource);
  const startScript = serverPackage.scripts?.start ?? "";
  const devScript = serverPackage.scripts?.dev ?? "";
  const devTsxScript = serverPackage.scripts?.["dev:tsx"] ?? "";

  assert.match(startScript, /dist\/scripts\/supervisor-entrypoint\.js/);
  assertNoDirectWorkerLaunch("server start script", startScript);
  assert.match(devScript, /scripts\/dev-runner\.ts/);
  assertNoDirectWorkerLaunch("server dev script", devScript);
  assert.match(devTsxScript, /scripts\/dev-runner\.ts/);
  assertNoDirectWorkerLaunch("server dev:tsx script", devTsxScript);

  assert.match(
    appIsolatedHostDaemon,
    /spawnTsx\("scripts\/supervisor-entrypoint\.ts", \["--dev"\]/,
  );
  assertNoSpawnedWorkerEntrypoint("app e2e isolated host daemon", appIsolatedHostDaemon);

  assert.match(serverConnectionOfferE2e, /scripts\/supervisor-entrypoint\.ts/);
  assertNoSpawnedWorkerEntrypoint("server daemon e2e process launch", serverConnectionOfferE2e);

  assert.match(desktopRuntimePaths, /"dist", "scripts", "supervisor-entrypoint\.js"/);
  assert.match(desktopRuntimePaths, /"scripts", "supervisor-entrypoint\.ts"/);
  assertNoDirectWorkerLaunch("desktop runtime paths", desktopRuntimePaths);

  assert.match(nixPackage, /dist\/scripts\/supervisor-entrypoint\.js/);
  assertNoDirectWorkerLaunch("Nix package wrapper", nixPackage);
  assert.match(nixPackage, /--set PASEO_NODE_ENV production/);
  assert.doesNotMatch(nixPackage, /--set(-default)?\s+NODE_ENV\b/);
  assert.doesNotMatch(nixModule, /\bNODE_ENV\b\s*=/);
  assert.doesNotMatch(nixModule, /\bPASEO_NODE_ENV\b/);
});

test("Bigbang development ignores inherited production connection settings", async () => {
  const { createDevProfile } = await import("./bigbang/dev.mjs");
  const root = "/tmp/paseo-fork";
  const profile = createDevProfile(root, {
    PATH: "/usr/bin",
    PASEO_HOME: "/Users/example/.paseo",
    PASEO_HOST: "localhost:6767",
    PASEO_DEV_SEED_HOME: "/Users/example/.paseo",
    PASEO_AGENT_ID: "official-agent",
    PASEO_ELECTRON_USER_DATA_DIR: "/Users/example/Library/Application Support/Paseo",
    EXPO_PUBLIC_LOCAL_DAEMON: "localhost:6767",
    APP_VARIANT: "production",
  });
  assert.equal(profile.env.PATH, "/usr/bin");
  assert.equal(profile.env.PASEO_HOME, join(root, ".dev/bigbang/paseo-home"));
  assert.equal(profile.env.PASEO_HOST, undefined);
  assert.equal(profile.env.PASEO_RELAY_ENABLED, "false");
  assert.equal(profile.env.PASEO_DEV_SEED_HOME, undefined);
  assert.equal(profile.env.PASEO_AGENT_ID, undefined);
  assert.equal(profile.env.EXPO_PUBLIC_LOCAL_DAEMON, undefined);
  assert.equal(profile.env.APP_VARIANT, "bigbang");
  assert.equal(profile.env.EXPO_PUBLIC_BIGBANG, "true");
  assert.equal(profile.env.PASEO_ELECTRON_USER_DATA_DIR, join(root, ".dev/bigbang/.dev/user-data"));
});

test("Bigbang development enables agent tools on a fresh home and preserves later settings", async () => {
  const { createDevProfile, prepareProfile } = await import("./bigbang/dev.mjs");
  const root = await mkdtemp(join(tmpdir(), "paseo-isolation-"));
  try {
    const profile = createDevProfile(root, {});
    await prepareProfile(profile);
    const configPath = join(profile.home, "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(config.daemon.mcp, { enabled: true, injectIntoAgents: true });
    config.daemon.mcp.injectIntoAgents = false;
    const edited = JSON.stringify(config);
    await writeFile(configPath, edited);
    await prepareProfile(profile);
    assert.equal(await readFile(configPath, "utf8"), edited);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Bigbang development rejects a config pointing at the official port without changing it", async () => {
  const { createDevProfile, prepareProfile } = await import("./bigbang/dev.mjs");
  const root = await mkdtemp(join(tmpdir(), "paseo-isolation-"));
  try {
    const profile = createDevProfile(root, {});
    await mkdir(profile.home, { recursive: true });
    const config = JSON.stringify({ daemon: { listen: "127.0.0.1:6767" } });
    const configPath = join(profile.home, "config.json");
    await writeFile(configPath, config);
    await assert.rejects(prepareProfile(profile), /differs from the isolated profile/);
    assert.equal(await readFile(configPath, "utf8"), config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Bigbang development refuses a symlink to another instance home", async () => {
  const { createDevProfile, prepareProfile } = await import("./bigbang/dev.mjs");
  const root = await mkdtemp(join(tmpdir(), "paseo-isolation-"));
  try {
    const profile = createDevProfile(root, {});
    const otherHome = join(root, "other-home");
    await mkdir(otherHome);
    await mkdir(profile.stateRoot, { recursive: true });
    await symlink(otherHome, profile.home, "dir");
    await assert.rejects(prepareProfile(profile), /must be a real directory/);
    await assert.rejects(readFile(join(otherHome, "config.json")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Bigbang development fails on an occupied port without stopping its listener", async () => {
  const { assertPortAvailable } = await import("./bigbang/dev.mjs");
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  try {
    const address = listener.address();
    await assert.rejects(assertPortAvailable(address.port), { code: "EADDRINUSE" });
    assert.equal(listener.listening, true);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});
