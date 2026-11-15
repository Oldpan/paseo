# Pavra 验收记录

按日期记录 Pavra Chat 与 Studio 的实测证据。阶段、顺序和当前状态见 [路线图](pavra-roadmap.md)；这里只放证据。

记录规则：

- 每条写明平台、版本、Git SHA、步骤、结果和限制。
- Web 通过不能代替 Android 真机或 Mac 安装包通过。
- 代码存在或单项测试通过不算阶段完成。
- 原始截图、测试输出和执行回执保存在忽略提交的 `.dev/pavra/`。

## 前期基础

已核验的前期结果是 Mac／Spark 的隔离运行、双向路由、PTY 和文件读回、双向真实 Agent 消息及完成通知，以及一次经单条命令审批的 Spark Agent 文件执行。它们证明对应基础能力，不等于新的 Chat 与 Studio 已整体验收。

[开发记录](pavra-development.md#presentation-shell) 保存源码迁移与 Web 验收边界；`extensions/pavra`、客户端 Pavra 界面、原生编辑器和独立打包配置已经落地。当前 Web 已验证新增 Grok 助手、真实中文回复、线程、窄屏侧栏、Studio 草稿保留和任务跳转。手动 Codex 任务已从 Spark 协调到 Mac 执行并回传结果。

持续会话有 15 项针对性回归，以及 Codex（gpt-6-luna）和 Grok（grok-4.6）真实两轮验证：重建协调器和重新打开 SQLite 后仍复用同一个执行 Agent，第二轮不重放旧历史；重复发送只执行一次。旧 Grok 重复执行和空工作区已软归档，原聊天记录保留。gpt-6.1-sol 的一次第二轮响应超时没有计为通过。

Chat 与 Paseo 的结合方式见 [Chat 协调](pavra-chat.md)：账本拥有聊天，执行 Agent 只负责执行；回合以 messageId 锚定，最终文本按锚点读取，生命周期钩子驱动、扫描兜底；助手通过插件 Agent 工具发起任务，身份由 daemon 按 Agent 绑定。

## 2026-10-27

2026-10-27 在 Mac 测试 daemon（6778，Pavra 插件作为协调器）与 Web（localhost:8181）上，用 Codex gpt-6-luna 于 `380fec01a` 实测通过：私聊流式回复并只提交一条 final，第二轮复用同一执行 Agent；聊天执行进入 background 工作区，不出现在 Studio 列表；助手经 `pavra__start_task` 在 Mac 本机及 Spark（主机名 aitopatom-e2eb）各完成一次 worktree 任务，任务卡、开始与完成回执和助手回报齐全，文件只写在任务 worktree；Bo 与 Cy 的圆桌按点名轮转三轮后以系统行结束。实测中发现并修复了三处问题：新建助手复用旧私聊 ID 导致聊天被覆盖、Codex 会话不感知后开启的自主权限、任务 worker 改写源目录。

同日 Spark 以 git bundle 升级到本分支（未推送），Spark 测试 daemon 启用 Pavra 插件作为协调器，旧账本直接沿用；Mac Web 经 SSH 主机连接选择它。于 `df232c377` 用 Grok 实测通过：旧版创建的 Grok 私聊沿用原执行 Agent 并保持上下文；新建的 Grok 4.7 助手流式回复、每回合只提交一条 final；助手经 `pavra-start_task` 在 Spark 完成一次 worktree 任务，首次以目录方式调用被授权拒绝后改用 worktree，任务卡、开始与完成回执和回报齐全，文件只写在 worktree。实测中发现并修复了三处问题：Grok 的 MCP 客户端协商后仍发送 `2026-07-28` 协议头，被 SDK 以 400 拒绝；Grok 拒绝注册名称含 `__` 的工具，插件 Agent 工具因此改名为 `<pluginId>-<name>`；任务 worktree 分支不再带 `codex/` 前缀。Grok 只在新建会话时连接 MCP，已有的 Grok 执行要在新会话（例如新线程）里才拿到工具。协调器重启后 Web 约一分钟才恢复连接，期间的错误提示要等账本下一次变化才消失。

同晚在 Mac 测试 daemon 重启到新代码后，用 Codex 群聊（Bo、Cy，默认回复人 Cy）于 `095f61f9d` 实测通过：无近期参与者时只有默认回复人回复；点名 @Bo 时 Bo 回复、近期参与者 Cy 收到 awareness 回合并 pass；普通消息让两位近期参与者都回复；新线程中 Bo 按要求点名 @Cy，Cy 以 mention 回合回复并记下冷却，Cy 未点名的回复进入 Bo 的 Peer Inbox，合并为一个 peer_inbox 回合后 Bo pass；回合进行中重启 daemon 后，该回合自动以 Interrupted 收尾、不提交 final，下一条消息由同一执行完成。实测中修复两处问题：普通消息把近期参与者都当作未被点名而全部 pass，现按原 Bigbang 规则让他们回复；daemon 重启后内存时间线丢失 messageId 锚点，回合永远停在运行中并堵住后续回合。线程执行只带线程根消息，看不到主线里的后续回复。

## 2026-10-28

2026-10-28 按旧 Bigbang 的多机协作补齐（`1e74914b2` 至 `1420a476c`），Mac 为协调器、Spark 为 member，于 `1420a476c` 实测通过：Spark 上的 Grok 助手 Sa 的 home、记忆与私聊执行都在 Spark，回合与工具调用经 member 中继回到 Mac 账本并按机器授权；Mac 上的 Codex 助手 Mo 用 `pavra-send` 私下问 Sa，Sa 的 mailbox 回合在 Spark 运行 `hostname`，回复 `aitopatom-e2eb` 唤醒 Mo 后告知用户；Studio 绑定 Mac 与 Spark 各一个工作区后，两端成员各收到一次通知，Mac 的 codex-mac 发消息给 Spark 的 grok-spark，后者经中继 `pavra-reply` 回到 codex-mac；Studio 关联 Mo 后，Mo 问 grok-spark 得到 `/tmp/bb-studio-spark`，codex-mac 问 Mo 也收到经 Studio 送回的回复。Web 的 Studio 协作面板显示了成员、关联助手与 Records。

## 2026-11-01

2026-11-01 在同一拓扑下，于 `4f8f1199f` 用 Codex gpt-6-luna 实测通过三项。

- **离线回执**：在 Mac 停用 Spark 的主机注册后，Studio 成员 codex-mac 按 key 给 grok-spark 发消息，收到 `not_attempted`（`host_offline`）。按名字发送时，离线机器上的成员不在成员列表里，返回 `studio_member_not_found`。重新启用 Spark 后，grok-spark 没有收到这条消息。
- **Mailbox 准入等待**：Bo 的私聊回复执行 `sleep 120` 期间，Mo 用 `pavra-send` 问 Bo。Bo 的 mailbox 回合记下首次等待时间后一直排队，等聊天回复结束才运行。回复在 8 秒内唤醒 Mo 并发到 Mo 的私聊，Bo 的聊天里没有出现 mailbox 内容。
- **内联审批**：Codex 每次调用 `pavra-send` 都会发起 MCP 确认。Studio 列和私聊都弹出了内联审批卡片，批准后工具照常执行；私聊回合在等待期间显示 `attention`。这类确认不会出现在 `paseo permit ls` 里。

同日实测角色互换（Spark 为协调器，Mac 为 member），测完已换回。Mac 测试 daemon 加了密码后，Spark 保存的 Mac 主机报 `authentication_failed`，测试期间临时去掉了密码，并让 daemon 只监听本机。

- **机器列表**：两边改写 `role` 并重载插件后，Spark 的机器列表要过一个探测周期才把 Mac 认作 member，之前显示为“自己也是协调器”。
- **聊天执行**：在 Spark 的 Chat 里新建绑定 Mac 的 Codex 助手 Rex。它的 home 和执行都在 Mac 上，写入的文件也落在 Mac 的 home 里。
- **中继与 Mailbox**：Rex 用 `pavra-send` 私下问 Spark 上的 Grok 助手 Gia。请求经 member 中继到达 Spark 账本，Gia 在 Spark 上运行 `hostname` 得到 `aitopatom-e2eb`，回复唤醒了 Rex。

实测发现的三个问题已在 `9aa6b8346` 修复：

- **Codex 把 MCP 工具藏在工具搜索后面**：助手提示词和 Studio 通知写明 pavra 工具是 paseo MCP 工具，不在列表里时先搜索 "pavra"。
- **选中 member 主机作为 Chat 协调器时没有说明**：现在说明它是哪台协调器的 member，并给出打开协调器的按钮。
- **切换协调器后加载报错不消失**：轮询错误按主机记录，切换后不再残留。

同日改为 Spark 长期当协调器：Spark 清空账本重新开始（旧账本备份为 `chat.sqlite.bak-20261101`），Mac 为 member，Mac 的旧账本不迁移。两台测试 daemon 都设了密码，互相以带密码的 `tcp://` 主机经 SSH 隧道连接。Spark 测试 daemon 提供 Pavra 网页。于 `9aa6b8346` 实测通过：

- Mac Web 选中 Mac 时显示 member 说明，点按钮直接打开 Spark 的 Chat，没有残留报错。
- 在空账本里新建 Spark 上的 Grok 助手 Sky 和 Mac 上的 Codex 助手 Max。用户只说“私下问一下 Sky”，Max 自己找到 `pavra-send` 发出请求；Sky 在 Spark 上运行 `hostname`，回复 `aitopatom-e2eb` 唤醒 Max 并告知用户。
- 经 Funnel 的公网地址能加载网页、WebSocket 能升级，但 Funnel 中继在这里只有约 15 KB/s：预压缩后的 3.8 MB 主程序首次加载仍要约 4 分钟，因此 Funnel 已关闭，改为 Spark 在局域网监听 6778，局域网加载主程序约 0.3 秒。手机登录使用尚待验证。

## 2026-11-10

2026-11-10 升级上游 `0.15.3` 后，在 Spark 协调器（`srv_tGAs1l4XHjbH`）与 Mac member（`srv_khQ9DQI8Ym0h`）双机拓扑上完成 R2 验收：

- **任务回执与继续聊天竞态修复**：`task_receipt` 回合不再被后续到达的用户消息标为 `SUPERSEDED`；其历史裁剪和 `lastMessageId` 推进固定到 `turn.triggerId`，避免吞掉任务完成后紧随到达的用户消息，并在已见消息无新增 delta 时以 `[turn.prompt]` 触发汇报。
- **双机并发聊天与任务执行**：Max（Mac，`codex/gpt-6-luna`）和 Sky（Spark，`grok/grok-4.7`）在 worktree 任务运行期间分别继续在原私聊发送消息并完成回合，聊天执行 Agent 与任务执行 Agent 互不抢占；两项任务均完成并写回 `notes/work-log` 与 `notes/channels`。
- **ConnectedHosts 代理绕行**：上游 `0.15.3` 的 `webSocketProxyAgent` 会将主机互联 WebSocket 走 `HTTP_PROXY`；`scripts/pavra/dev.mjs` 已将双机 Tailscale 地址加入 `NO_PROXY` 直连。

## 2026-11-14

Spark 上自托管的 Paseo relay，部署方式见 [pavra-development.md](pavra-development.md#self-hosted-relay)。relay 源码 `getpaseo/paseo-relay@5f4b763`，本地构建的 arm64 镜像；cpolar 3.3.12，区域 `cn_vip`。

- **本机**：容器只监听 `127.0.0.1:4000`，`/health` 和 `/ready` 返回 200。
- **公网**：从 Mac 不经代理访问 `https://bigbang-paseo.vip.cpolar.cn/health` 返回 200，用时约 0.24 秒。
- **WebSocket**：从 Mac 对 `wss://bigbang-paseo.vip.cpolar.cn/ws?role=server&serverId=<探测用>&v=2` 握手得到 101，并收到 relay 的 `sync` 帧。cpolar 的 HTTP 隧道能转发 WebSocket。

同日把 Spark 的测试 daemon（0.15.3，`fd63431f9`）接到这台 relay 上：

- **登记**：重启 6778 后 daemon 日志出现 `relay_control_connected`，relay 指标显示 1 个活动会话。官方 6767 的进程号前后一致。
- **配对链接**：`daemon pair` 生成的链接里 relay 地址是 `bigbang-paseo.vip.cpolar.cn:443`，带 TLS。
- **端到端**：在 Spark 上用普通命令行客户端加配对链接和 daemon 密码执行 `ls`，经公网域名、cpolar、relay 回到 daemon，读到 21 个 Agent，与本机直连一致；relay 记录到 1 次 v2 `e2ee_hello` 握手。
- **主机连接**：重启后 Spark 到 Mac 的主机连接恢复为 online。

限制：客户端跑在 Spark 自己身上，流量出去再经 cpolar 回来，没有从别的网络或蜂窝网络测过，也没有测长连接的稳定性。还没有用 App 配对过；配对链接指向 `app.paseo.sh`，Pavra 的 Android 包能否接住这个链接未验证。

同日基于 `3b866d9ae` 在 Spark 协调器（`srv_tGAs1l4XHjbH`、`http://192.168.0.149:6778/`）与 Mac member（`srv_khQ9DQI8Ym0h`）双机实测完成“Chat 收尾”：

- **气泡单行状态与查看过程抽屉**：进行中气泡只展示回复正文与单行状态（`activity`、最新单行 `commentary` 或状态名）；进行中和已完成的助手消息均提供 `View process`，点击在右侧打开 `TurnProcessDrawer`（复用 Paseo `AgentStreamView` 渲染该回合锚点后的 timeline，包裹 `PaneFocusProvider` 修复 Web 端 `ChatFind` 焦点上下文报错），点抽屉内 `Studio` 可直接打开对应执行工作区列（截图存 `.dev/pavra/stage1-process-drawer.png`、`stage1-process-open-studio.png`）。
- **待发排队条、中途插话（`steer`）与取消**：回合运行中发送消息默认进入输入框上方的 `PendingQueueBar`（截图存 `.dev/pavra/stage1-pending-queue-bar.png`）；点 `Remove` 移出队列并在草稿为空时回填文本；等待当前回合结束会自动发出队首消息并完成回合（`35c9f867`）；点 `Steer` 或带 `delivery: "steer"` 发送会立即把原回合标为 `cancelled`（`Superseded by a newer message.`），并在同一执行 Agent（`3b572a13`）内直接插话完成新回合（RPC 实测 `9f829070`、Web 实测 `0d505885`）；调用 `pavra.turn.cancel` 可中止运行中回合（`d59ffa75`），下一条消息继续复用同一执行 Agent（`bf16925a`）。
- **并发、游标恢复、迟到结果 fence 与审批**：Sky（Spark，`grok/grok-4.7`，回合 `f8715bdb`）与 Max（Mac，`codex/gpt-6-luna`，回合 `faba34b4`）并发完成回复，新客户端凭断开前游标（`250` → `262`）重连拉回全部增量消息；Max 调用 `pavra-peers` 与 `pavra-send` 时触发 Codex MCP 内联审批，批准后向 Sky 发出 mailbox 请求（`d1201233`），随即取消发起回合（`50b2a15a`），mailbox 记录立即变为 `cancelled`，Sky 随后结束的迟到结果被 fence 拦截（未生成 wakeup 回合）。Spark 上 Grok（`~/.grok/config.toml`）配置为 `permission_mode = "always-approve"`，命令与 MCP 工具直接执行，不触发审批。

## 2026-11-15

基于 `b1c6acbcb`、`5b8cbaa58`、`38fbc25ab` 与 `2f1328da0` 在 Spark 协调器（`srv_tGAs1l4XHjbH`）与 Mac member（`srv_khQ9DQI8Ym0h`）双机实测通过操作手册（Playbooks）、例行与提醒（T0–T1）、收件箱（Inbox）及本地通知与手机配对入口（Stage 2）：

- **操作手册（Playbooks，`b1c6acbcb`）**：在 Sky（Spark 本机存储）与 Max（经 `member.playbook.*` 中继读写 Mac home）上分别验证 `chat.assistant.playbook.write`、`list`、`read`、`delete` 及 `expectedMtimeMs` 乐观锁冲突拦截；在 Max 私聊发送执行指令时，回合提示词注入 `[Playbooks]` 索引，Max 读取 `playbooks/daily-health.md` 并按手册返回结果。
- **例行与一次性提醒（T0–T1，`5b8cbaa58`）**：在 Sky 上创建引用 `playbooks/daily-workspace-check.md` 的例行（`eb914949`）并执行 `chat.routine.run_once`，回合（`1d05452e`）回复 `(pass)` 后运行记录（`825ce72a`）记为 `outcome: "passed"`，私聊未新增消息气泡（`messagesBefore: 4`、`messagesAfter: 4`）；在 Max 上创建一次性提醒（`b9535f7c`，`maxRuns: 1`）并触发运行，回合（`5ec8d031`）跨机完成后提交带 `routineId`／`routineName` 标记的 `final` 消息，运行记录（`bc3d24cb`）记为 `outcome: "replied"`，提醒自动转为 `status: "completed"`、`nextRunAt: null`（回执存 `.dev/pavra/stage-a2-routines-acceptance.json`）。
- **收件箱（Inbox，`38fbc25ab`）**：`deriveInboxState` 从 `chat.state` 纯函数派生 `needsAction`（任务工具审批、回合 `attention`、任务预算耗尽）、`recentActivity`（例行运行结果与任务回执）、`upcoming`（按 `nextRunAt` 升序的活动例行与提醒）和 `suggestions`（超时或失败未追问任务、最新失败回合、已暂停或最近失败例行），不调用模型；审批处理、预算续行或例行暂停后对应项立即从原分段移除或转入建议（回执存 `.dev/pavra/stage-c-inbox-acceptance.json`）。
- **本地通知、点击跳转与手机配对入口（Stage 2，`2f1328da0`）**：`createPavraNotificationTracker` 对 Spark `chat.state` 实时状态做增量去重比对：首次快照（`cursor: 70`）写入 `12` 个已见 key、发出 `0` 条通知；在 Sky 上触发一次性提醒例行（`cd639e4c`，运行 `53a41b3e`，回合 `24a5090d`）回复 `STAGE2_NOTIFY_OK` 后，游标推进首次发出 1 条 `routine_reply` 通知（`key: "msg:final:24a5090d-8181-44d0-9bfd-0074c4ad4583"`，`target: { serverId: "srv_tGAs1l4XHjbH", pavraSection: "chat", pavraConversationId: "dm:sky", pavraThreadId: null }`），后续增量与全量轮询均发出 `0` 条重复通知；`parseNotificationOpenTarget` 与 `buildPavraNotificationRoute` 解析为 `/pavra?serverId=srv_tGAs1l4XHjbH&section=chat&chatId=dm%3Asky` 并自动切换协调器与对应聊天或收件箱（回执存 `.dev/pavra/stage2-notifications-acceptance.json`）。`CoordinatorPickerModal` 与 `Member → Machines` 已接入配对链接粘贴与 `pavra://` 深链支持。限制：Android 真机蜂窝配对与锁屏通知尚待实机验证。
- **Android ARM64 安装包 Hermes 兼容与窄屏界面验收（`fdda8265e`、`408f71cbb`、`70661b22c`）**：针对 Android 真机打开 `ConversationPane` 报 `TypeError: undefined is not a function (at openExchanges)` 的崩溃，直接比对 APK 内 `lib/arm64-v8a/libhermesvm.so` 符号表确认当前 React Native Hermes 未实现 `Array.prototype.toSorted`（及 `Object.groupBy`／`Map.groupBy`），将 `peer-activity.ts`、`playbooks.ts`、`routines.ts` 与 `group.ts` 中的 `.toSorted()`／`.toReversed()` 替换为新数组 `.sort()` 与倒序循环，并新增 `hermes-compat.test.ts` 源码扫描与原型删除回归测试；同时修复 `PavraPage` 缺少 `useSafeAreaInsets` 导致顶栏 `Open sidebar`（`☰`）落入 Android 状态栏（`y < 136`）无法点击的问题，以及窄屏 `Studio` 未回退首个活动列和横向 `ScrollView` 抢占手势的问题。在 Android 16 ARM64 模拟器（`Bigbang_Studio_API36_arm64`）安装 `artifacts/pavra-arm64.apk`（`com.oldpan.pavra`）并直连 Spark `192.168.0.149:6778` 协调器实测：Sky 与 Max 私聊（含消息流、`Routines`、`Playbooks` 标签页）、左侧抽屉导航、`Inbox · 收件箱` 四分段、`Member → Machines` 双机列表、`Studio` 工作区列表及 `pavra://pavra?section=inbox` 深链均正常渲染与切换，`adb logcat` 全程 `0` 条 `ReactNativeJS`／`AndroidRuntime` 报错（截图存 `.dev/pavra/android-verified-chat.png`、`android-verified-max.png`、`android-verified-inbox.png`、`android-verified-sidebar.png`、`android-verified-machines.png`、`android-verified-routines.png`、`android-verified-playbooks.png`、`android-verified-studio.png`）。限制：本次在 Mac 本地 Android 16 ARM64 模拟器直连局域网协调器验证，蜂窝网络经 cpolar relay 配对与锁屏通知仍待实体手机核验。

## 尚未验收

原生端尚未验证（Spark 上 Grok 配置为 `always-approve`，未单独测询问模式下的审批卡片）。例行 7 天连续运行验收进行中。

附件上传、表情反应和旧 Core 专属斜杠命令尚未接通，界面不暴露无效控件。Android 真机、Mac 安装包、终端迁移前后延迟及完整视觉对照仍待验收。原始截图、测试输出和执行回执保存在忽略提交的 `.dev/pavra/`；本路线图不把已有代码或单项测试通过视为整阶段完成。
