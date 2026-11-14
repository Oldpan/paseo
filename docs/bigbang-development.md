# Bigbang development

Local isolation, the Mac + Spark two-machine setup, day-to-day sync, and upstream merge cadence for the `bigbang/isolation` branch. Product scope lives in the [Bigbang roadmap](bigbang-roadmap.md); Chat coordination lives in [Bigbang Chat](bigbang-chat.md).

## Fork isolation

Run the fork profile on macOS or Linux while the official Paseo installation is running:

```bash
npm run bigbang:profile
npm run bigbang:server   # separate terminal
npm run bigbang:app      # separate terminal
# Optional desktop client, after npm run build:app-deps:
npm run bigbang:desktop
npm run bigbang:cli -- daemon status --json
```

| Surface          | Official installation | Bigbang development                      |
| ---------------- | --------------------- | ---------------------------------------- |
| Daemon           | `127.0.0.1:6767`      | `127.0.0.1:6778`                         |
| Runtime state    | `~/.paseo`            | `<checkout>/.dev/bigbang/paseo-home`     |
| Web client       | Official app          | `http://localhost:8181`                  |
| Desktop renderer | Packaged assets       | `http://localhost:8182`                  |
| Desktop profile  | Official userData     | `<checkout>/.dev/bigbang/.dev/user-data` |

The launcher removes inherited Paseo/Expo settings, creates a fresh private home, disables relay and speech-model downloads, and never seeds official agents or host connections. Fresh homes enable Paseo tools inside Agents (`daemon.mcp.enabled` and `daemon.mcp.injectIntoAgents`); an existing home keeps its explicit settings. An occupied port fails startup; do not stop another instance to free it. Avoid globally installing the fork CLI or replacing `/Applications/Paseo.app`.

A separate Paseo home isolates daemon state, not provider credentials or workspace files. Use disposable project directories for tests; do not attach or resume official Agent sessions.

Fork builds use `npm run bigbang:apk:arm64`, `npm run bigbang:build:web`, and `npm run bigbang:build:desktop`. Packaged desktop state uses `~/.bigbang-paseo` on port `6777`; development stays on the profile above. Official Paseo updates are disabled for the fork.

## Presentation shell

The presentation source lives in `packages/app/src/bigbang/ui` (migrated from Bigbang `apps/app/src` at `f9e502a9a73024a8f2cbfc1aa67c52d70b7265ae`). Keep its palette, typography, pixel avatars, shadows, Markdown, composer, sidebar, and tab chrome together. `IS_BIGBANG` (`packages/app/src/bigbang/build.ts`) turns Paseo's left sidebar off and maps Paseo routes into one shell:

| Paseo surface                          | Bigbang build                                                      |
| -------------------------------------- | ------------------------------------------------------------------ |
| `/open-project` home                   | Studio home (`/open-project` redirects there, so fallbacks do too) |
| Workspace route, `navigateToWorkspace` | A Studio column in the "Workspaces" tab group                      |
| History, Schedules, a new workspace    | The Paseo page inside `BigbangPage`, with the rail beside it       |
| Usage, Settings                        | Rail buttons; leaving Settings returns to `/bigbang`               |
| Hosts                                  | Member → Machines, with each host's Bigbang role                   |

In the Bigbang build, Paseo's `light` and `dark` themes are built from the Bigbang palette with Bigbang's outlines and offset shadows in `theme.chrome`, and Appearance offers only `light`, `dark`, and `system` (`packages/app/src/appearance/theme-picker.tsx`). `/bigbang` stays at the bottom of the stack while hosted pages replace one another above it, so Chat and Studio keep their retained panels. Core-only controls stay hidden until their host capabilities are connected.

## Mac and Spark topology

| Machine | Checkout                  | Role          | Daemon listen  | Responsibilities                                                                         |
| ------- | ------------------------- | ------------- | -------------- | ---------------------------------------------------------------------------------------- |
| Spark   | `/ai/code/paseo-bigbang`  | `coordinator` | `0.0.0.0:6778` | Always-on Chat SQLite ledger (`$PASEO_HOME/bigbang/chat.sqlite`), prebuilt Web UI entry  |
| Mac     | `/Users/oldpan/.../paseo` | `member`      | `0.0.0.0:6778` | Primary authoring environment, Fast Refresh dev client (`:8181`/`:8182`), member machine |

Spark is the long-term Chat coordinator and external service entry because it stays on when the Mac sleeps or travels. Chat needs one link per member, from the coordinator to that member ([Machines](bigbang-chat.md#machines)), so only Spark saves a host over Tailscale:

```bash
# On Spark: save the Mac by its Tailscale address.
npm run bigbang:cli -- host add 'tcp://<Mac Tailscale IP>:6778?password=<Mac password>' --label 'Mac · Bigbang Dev' --json
```

Roles are the plugin's `role` setting (`settings.role.write`), applied on plugin reload: Spark `{ "mode": "coordinator" }`, the Mac `{ "mode": "member", "coordinatorServerId": "<Spark serverId>" }`.

Spark serves the prebuilt Bigbang web app from `packages/server/dist/server/web-ui` (`features.webUi` in Spark's `config.json`) via `.dev/bigbang/bigbang-lan.mjs` (`PASEO_LISTEN=0.0.0.0:6778`). On the LAN open `http://192.168.0.149:6778`. Tailscale Funnel publishes the same UI at `https://aitopatom-e2eb.tail24679f.ts.net/` (HTTPS 443 `/`, with `/tb21` and `/monitor` kept as more specific Funnel paths). The daemon password still applies; static files load before login. Disable with `tailscale funnel --https=443 --set-path=/ off` on Spark. Funnel relays have been slow for the ~4 MB brotli bundle; a device already on the tailnet uses the same URL over Serve and stays fast. Port 10000 remains a fallback Funnel (`https://aitopatom-e2eb.tail24679f.ts.net:10000/`). Workspace services meant to be reachable while the Mac is asleep also run on Spark and are exposed from Spark ([Service Proxy](service-proxy.md)). Codex and Grok on Spark use the local provider proxy at `127.0.0.1:7893`; machine-specific identities and acceptance receipts stay in `.dev/bigbang/mac-spark-evidence.json` on each checkout.

## Self-hosted relay

The phone reaches Spark through a Paseo relay that runs on Spark itself. A cpolar HTTP tunnel gives it the public address `bigbang-paseo.vip.cpolar.cn`. The relay only sees ciphertext, and so does cpolar; see [SECURITY.md](../SECURITY.md).

The published image `ghcr.io/getpaseo/paseo-relay` is amd64 only and Spark is arm64, so build it from source at a pinned commit:

```bash
git clone https://github.com/getpaseo/paseo-relay.git /ai/code/paseo-relay
cd /ai/code/paseo-relay && git checkout 5f4b7636af41a85ef20200c0b7e99dd1ea2ee1f2
docker build --network host \
  --build-arg HTTP_PROXY=http://127.0.0.1:7897 --build-arg HTTPS_PROXY=http://127.0.0.1:7897 \
  -t paseo-relay:5f4b763 .
docker run -d --name paseo-relay --restart unless-stopped \
  -e LANG=C.UTF-8 -e LC_ALL=C.UTF-8 -p 127.0.0.1:4000:4000 paseo-relay:5f4b763
```

- `--network host` lets the build reach Spark's local proxy for Docker Hub, Hex and apt.
- Without `LANG`, the Erlang VM starts in latin1 and warns that Elixir may malfunction.
- Publish the port on `127.0.0.1` only. cpolar is the only public way in.

The tunnel is the `bigbang-paseo` entry in `/home/oldpan/.cpolar/cpolar.yml` (`proto: http`, `addr: 4000`, `subdomain: bigbang-paseo`, `region: cn_vip`). The file also holds the cpolar authtoken, so never print it. `cpolar.service` runs `start-all`, which brings up every tunnel in the file, and it is not enabled at boot: after a Spark reboot run `sudo systemctl start cpolar`. cpolar reads the file only at start, so restart it after an edit.

Check both hops:

```bash
curl -s http://127.0.0.1:4000/ready                      # on Spark
curl -s https://bigbang-paseo.vip.cpolar.cn/health        # from anywhere
```

The dev profile (`scripts/bigbang/dev.mjs`) turns relay off for every Bigbang daemon. Spark's launcher `.dev/bigbang/bigbang-lan.mjs` turns it back on with launch overrides, which win over `config.json`:

```js
PASEO_RELAY_ENABLED: "true",
PASEO_RELAY_ENDPOINT: "127.0.0.1:4000", // the daemon dials the container directly
PASEO_RELAY_USE_TLS: "false",
PASEO_RELAY_PUBLIC_ENDPOINT: "bigbang-paseo.vip.cpolar.cn:443", // what a pairing link carries
PASEO_RELAY_PUBLIC_USE_TLS: "true",
```

Leave `daemon.relay.enabled: false` in Spark's `config.json`: the dev profile refuses to launch when it is anything else. The daemon logs `relay_control_connected` once it has registered.

Pair with `npm run bigbang:cli -- daemon pair`. The link and QR code let anyone who holds them reach the daemon's password prompt, so do not paste them into chats or docs. `bigbang:cli` rejects `--host`; to test a pairing link from a shell use `npm run cli -- ls --host '<link>'` with `PASEO_PASSWORD` set.

## Day-to-day workflow

Author on the Mac and sync to Spark after completing each feature:

1. **UI and client changes (`packages/app/src/bigbang/*`).** Run `npm run bigbang:app` (`http://localhost:8181`) or `npm run bigbang:desktop` (`http://localhost:8182`) on the Mac for instant Metro Fast Refresh while iterating, then sync and rebuild Spark's static `web-ui` bundle once the feature is complete:
   ```bash
   npm run bigbang:sync-spark -- --web-ui
   ```
2. **Plugin and coordination changes (`extensions/bigbang/*`).** Run the targeted unit test on the Mac first, then sync and hot-reload the plugin on both machines without restarting either daemon:
   ```bash
   npx vitest run extensions/bigbang/server/coordinator.test.ts --bail=1
   npm run bigbang:sync-spark            # one-shot rsync + plugin reload on Mac & Spark
   npm run bigbang:sync-spark -- --watch # continuous watch mode on save
   ```
3. **Commit and align both checkouts.** After committing on `bigbang/isolation`, push to both `origin` and the `spark` git remote (`OLDPAN-AI:/ai/code/paseo-bigbang`, configured with `receive.denyCurrentBranch=updateInstead`):

   ```bash
   git push origin bigbang/isolation && git push spark
   ```

   - If `packages/protocol`, `packages/client`, `packages/plugin`, or `packages/server` changed, run `npm run build:server` and `npm run bigbang:cli -- daemon restart` on the affected machine so the supervisor respawns its worker on the new build.
   - When ready to use the standalone Spark `:6778` web entry from a phone or with the Mac asleep, rebuild Spark's static bundle (`npm run bigbang:sync-spark -- --web-ui`, or `npm run bigbang:build:daemon-web-ui` on Spark).

## Upstream merge cadence

Develop on `bigbang/isolation` and merge `upstream/main` (`https://github.com/getpaseo/paseo.git`) once a week. Upstream lands about 18 commits a day, and the fork's host changes sit in the agent MCP and plugin tool code that upstream edits most, so a longer gap means a larger conflict. Generic host extensions (agent MCP identity binding, audience-scoped plugin agent tools) go upstream as PRs so the fork stops carrying them:

1. Keep Bigbang logic inside `extensions/bigbang/` and `packages/app/src/bigbang/`. Guard necessary hooks in shared Paseo files with `IS_BIGBANG` rather than altering upstream function signatures.
2. Fetch and merge upstream on a clean working tree:
   ```bash
   git fetch upstream main
   git merge upstream/main
   ```
3. Run `npm install` (run a second time if `postinstall-patches.mjs` clears an old patched package directory), then `npm run build:server`, `npm run typecheck`, `npm run lint`, and `npm run format`.
4. Verify both plugin agent-tool models (`packages/server/src/server/plugins/agent-tools.e2e.test.ts` and `packages/server/src/server/plugins/audience-agent-tools.e2e.test.ts`) and `extensions/bigbang/server/coordinator.test.ts` before pushing to `origin` and `spark`.
