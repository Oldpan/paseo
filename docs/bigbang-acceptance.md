# Bigbang 验收记录

按日期记录 Bigbang Chat 与 Studio 的实测证据。阶段、顺序和当前状态见 [路线图](bigbang-roadmap.md)；这里只放证据。

记录规则：

- 每条写明平台、版本、Git SHA、步骤、结果和限制。
- Web 通过不能代替 Android 真机或 Mac 安装包通过。
- 代码存在或单项测试通过不算阶段完成。
- 原始截图、测试输出和执行回执保存在忽略提交的 `.dev/bigbang/`。

## 前期基础

已核验的前期结果是 Mac／Spark 的隔离运行、双向路由、PTY 和文件读回、双向真实 Agent 消息及完成通知，以及一次经单条命令审批的 Spark Agent 文件执行。它们证明对应基础能力，不等于新的 Chat 与 Studio 已整体验收。

[开发记录](development.md#bigbang-presentation-migration) 保存源码迁移与 Web 验收边界；`extensions/bigbang`、客户端 Bigbang 界面、原生编辑器和独立打包配置已经落地。当前 Web 已验证新增 Grok 助手、真实中文回复、线程、窄屏侧栏、Studio 草稿保留和任务跳转。手动 Codex 任务已从 Spark 协调到 Mac 执行并回传结果。

持续会话有 15 项针对性回归，以及 Codex（gpt-6-luna）和 Grok（grok-4.6）真实两轮验证：重建协调器和重新打开 SQLite 后仍复用同一个执行 Agent，第二轮不重放旧历史；重复发送只执行一次。旧 Grok 重复执行和空工作区已软归档，原聊天记录保留。gpt-6.1-sol 的一次第二轮响应超时没有计为通过。

Chat 与 Paseo 的结合方式见 [Chat 协调](bigbang-chat.md)：账本拥有聊天，执行 Agent 只负责执行；回合以 messageId 锚定，最终文本按锚点读取，生命周期钩子驱动、扫描兜底；助手通过插件 Agent 工具发起任务，身份由 daemon 按 Agent 绑定。

## 2026-10-27

2026-10-27 在 Mac 测试 daemon（6778，Bigbang 插件作为协调器）与 Web（localhost:8181）上，用 Codex gpt-6-luna 于 `380fec01a` 实测通过：私聊流式回复并只提交一条 final，第二轮复用同一执行 Agent；聊天执行进入 background 工作区，不出现在 Studio 列表；助手经 `bigbang__start_task` 在 Mac 本机及 Spark（主机名 aitopatom-e2eb）各完成一次 worktree 任务，任务卡、开始与完成回执和助手回报齐全，文件只写在任务 worktree；Bo 与 Cy 的圆桌按点名轮转三轮后以系统行结束。实测中发现并修复了三处问题：新建助手复用旧私聊 ID 导致聊天被覆盖、Codex 会话不感知后开启的自主权限、任务 worker 改写源目录。

同日 Spark 以 git bundle 升级到本分支（未推送），Spark 测试 daemon 启用 Bigbang 插件作为协调器，旧账本直接沿用；Mac Web 经 SSH 主机连接选择它。于 `df232c377` 用 Grok 实测通过：旧版创建的 Grok 私聊沿用原执行 Agent 并保持上下文；新建的 Grok 4.7 助手流式回复、每回合只提交一条 final；助手经 `bigbang-start_task` 在 Spark 完成一次 worktree 任务，首次以目录方式调用被授权拒绝后改用 worktree，任务卡、开始与完成回执和回报齐全，文件只写在 worktree。实测中发现并修复了三处问题：Grok 的 MCP 客户端协商后仍发送 `2026-07-28` 协议头，被 SDK 以 400 拒绝；Grok 拒绝注册名称含 `__` 的工具，插件 Agent 工具因此改名为 `<pluginId>-<name>`；任务 worktree 分支不再带 `codex/` 前缀。Grok 只在新建会话时连接 MCP，已有的 Grok 执行要在新会话（例如新线程）里才拿到工具。协调器重启后 Web 约一分钟才恢复连接，期间的错误提示要等账本下一次变化才消失。

同晚在 Mac 测试 daemon 重启到新代码后，用 Codex 群聊（Bo、Cy，默认回复人 Cy）于 `095f61f9d` 实测通过：无近期参与者时只有默认回复人回复；点名 @Bo 时 Bo 回复、近期参与者 Cy 收到 awareness 回合并 pass；普通消息让两位近期参与者都回复；新线程中 Bo 按要求点名 @Cy，Cy 以 mention 回合回复并记下冷却，Cy 未点名的回复进入 Bo 的 Peer Inbox，合并为一个 peer_inbox 回合后 Bo pass；回合进行中重启 daemon 后，该回合自动以 Interrupted 收尾、不提交 final，下一条消息由同一执行完成。实测中修复两处问题：普通消息把近期参与者都当作未被点名而全部 pass，现按原 Bigbang 规则让他们回复；daemon 重启后内存时间线丢失 messageId 锚点，回合永远停在运行中并堵住后续回合。线程执行只带线程根消息，看不到主线里的后续回复。

## 2026-10-28

2026-10-28 按旧 Bigbang 的多机协作补齐（`1e74914b2` 至 `1420a476c`），Mac 为协调器、Spark 为 member，于 `1420a476c` 实测通过：Spark 上的 Grok 助手 Sa 的 home、记忆与私聊执行都在 Spark，回合与工具调用经 member 中继回到 Mac 账本并按机器授权；Mac 上的 Codex 助手 Mo 用 `bigbang-send` 私下问 Sa，Sa 的 mailbox 回合在 Spark 运行 `hostname`，回复 `aitopatom-e2eb` 唤醒 Mo 后告知用户；Studio 绑定 Mac 与 Spark 各一个工作区后，两端成员各收到一次通知，Mac 的 codex-mac 发消息给 Spark 的 grok-spark，后者经中继 `bigbang-reply` 回到 codex-mac；Studio 关联 Mo 后，Mo 问 grok-spark 得到 `/tmp/bb-studio-spark`，codex-mac 问 Mo 也收到经 Studio 送回的回复。Web 的 Studio 协作面板显示了成员、关联助手与 Records。

## 2026-11-01

2026-11-01 在同一拓扑下，于 `4f8f1199f` 用 Codex gpt-6-luna 实测通过三项。

- **离线回执**：在 Mac 停用 Spark 的主机注册后，Studio 成员 codex-mac 按 key 给 grok-spark 发消息，收到 `not_attempted`（`host_offline`）。按名字发送时，离线机器上的成员不在成员列表里，返回 `studio_member_not_found`。重新启用 Spark 后，grok-spark 没有收到这条消息。
- **Mailbox 准入等待**：Bo 的私聊回复执行 `sleep 120` 期间，Mo 用 `bigbang-send` 问 Bo。Bo 的 mailbox 回合记下首次等待时间后一直排队，等聊天回复结束才运行。回复在 8 秒内唤醒 Mo 并发到 Mo 的私聊，Bo 的聊天里没有出现 mailbox 内容。
- **内联审批**：Codex 每次调用 `bigbang-send` 都会发起 MCP 确认。Studio 列和私聊都弹出了内联审批卡片，批准后工具照常执行；私聊回合在等待期间显示 `attention`。这类确认不会出现在 `paseo permit ls` 里。

同日实测角色互换（Spark 为协调器，Mac 为 member），测完已换回。Mac 测试 daemon 加了密码后，Spark 保存的 Mac 主机报 `authentication_failed`，测试期间临时去掉了密码，并让 daemon 只监听本机。

- **机器列表**：两边改写 `role` 并重载插件后，Spark 的机器列表要过一个探测周期才把 Mac 认作 member，之前显示为“自己也是协调器”。
- **聊天执行**：在 Spark 的 Chat 里新建绑定 Mac 的 Codex 助手 Rex。它的 home 和执行都在 Mac 上，写入的文件也落在 Mac 的 home 里。
- **中继与 Mailbox**：Rex 用 `bigbang-send` 私下问 Spark 上的 Grok 助手 Gia。请求经 member 中继到达 Spark 账本，Gia 在 Spark 上运行 `hostname` 得到 `aitopatom-e2eb`，回复唤醒了 Rex。

实测发现的三个问题已在 `9aa6b8346` 修复：

- **Codex 把 MCP 工具藏在工具搜索后面**：助手提示词和 Studio 通知写明 bigbang 工具是 paseo MCP 工具，不在列表里时先搜索 "bigbang"。
- **选中 member 主机作为 Chat 协调器时没有说明**：现在说明它是哪台协调器的 member，并给出打开协调器的按钮。
- **切换协调器后加载报错不消失**：轮询错误按主机记录，切换后不再残留。

同日改为 Spark 长期当协调器：Spark 清空账本重新开始（旧账本备份为 `chat.sqlite.bak-20261101`），Mac 为 member，Mac 的旧账本不迁移。两台测试 daemon 都设了密码，互相以带密码的 `tcp://` 主机经 SSH 隧道连接。Spark 测试 daemon 提供 Bigbang 网页。于 `9aa6b8346` 实测通过：

- Mac Web 选中 Mac 时显示 member 说明，点按钮直接打开 Spark 的 Chat，没有残留报错。
- 在空账本里新建 Spark 上的 Grok 助手 Sky 和 Mac 上的 Codex 助手 Max。用户只说“私下问一下 Sky”，Max 自己找到 `bigbang-send` 发出请求；Sky 在 Spark 上运行 `hostname`，回复 `aitopatom-e2eb` 唤醒 Max 并告知用户。
- 经 Funnel 的公网地址能加载网页、WebSocket 能升级，但 Funnel 中继在这里只有约 15 KB/s：预压缩后的 3.8 MB 主程序首次加载仍要约 4 分钟，因此 Funnel 已关闭，改为 Spark 在局域网监听 6778，局域网加载主程序约 0.3 秒。手机登录使用尚待验证。

## 2026-11-10

2026-11-10 升级上游 `0.15.3` 后，在 Spark 协调器（`srv_tGAs1l4XHjbH`）与 Mac member（`srv_khQ9DQI8Ym0h`）双机拓扑上完成 R2 验收：

- **任务回执与继续聊天竞态修复**：`task_receipt` 回合不再被后续到达的用户消息标为 `SUPERSEDED`；其历史裁剪和 `lastMessageId` 推进固定到 `turn.triggerId`，避免吞掉任务完成后紧随到达的用户消息，并在已见消息无新增 delta 时以 `[turn.prompt]` 触发汇报。
- **双机并发聊天与任务执行**：Max（Mac，`codex/gpt-6-luna`）和 Sky（Spark，`grok/grok-4.7`）在 worktree 任务运行期间分别继续在原私聊发送消息并完成回合，聊天执行 Agent 与任务执行 Agent 互不抢占；两项任务均完成并写回 `notes/work-log` 与 `notes/channels`。
- **ConnectedHosts 代理绕行**：上游 `0.15.3` 的 `webSocketProxyAgent` 会将主机互联 WebSocket 走 `HTTP_PROXY`；`scripts/bigbang/dev.mjs` 已将双机 Tailscale 地址加入 `NO_PROXY` 直连。

## 2026-11-14

Spark 上自托管的 Paseo relay，部署方式见 [bigbang-development.md](bigbang-development.md#self-hosted-relay)。relay 源码 `getpaseo/paseo-relay@5f4b763`，本地构建的 arm64 镜像；cpolar 3.3.12，区域 `cn_vip`。

- **本机**：容器只监听 `127.0.0.1:4000`，`/health` 和 `/ready` 返回 200。
- **公网**：从 Mac 不经代理访问 `https://bigbang-paseo.vip.cpolar.cn/health` 返回 200，用时约 0.24 秒。
- **WebSocket**：从 Mac 对 `wss://bigbang-paseo.vip.cpolar.cn/ws?role=server&serverId=<探测用>&v=2` 握手得到 101，并收到 relay 的 `sync` 帧。cpolar 的 HTTP 隧道能转发 WebSocket。

同日把 Spark 的测试 daemon（0.15.3，`fd63431f9`）接到这台 relay 上：

- **登记**：重启 6778 后 daemon 日志出现 `relay_control_connected`，relay 指标显示 1 个活动会话。官方 6767 的进程号前后一致。
- **配对链接**：`daemon pair` 生成的链接里 relay 地址是 `bigbang-paseo.vip.cpolar.cn:443`，带 TLS。
- **端到端**：在 Spark 上用普通命令行客户端加配对链接和 daemon 密码执行 `ls`，经公网域名、cpolar、relay 回到 daemon，读到 21 个 Agent，与本机直连一致；relay 记录到 1 次 v2 `e2ee_hello` 握手。
- **主机连接**：重启后 Spark 到 Mac 的主机连接恢复为 online。

限制：客户端跑在 Spark 自己身上，流量出去再经 cpolar 回来，没有从别的网络或蜂窝网络测过，也没有测长连接的稳定性。还没有用 App 配对过；配对链接指向 `app.paseo.sh`，Bigbang 的 Android 包能否接住这个链接未验证。

## 尚未验收

并发与断线的实机行为、Grok 下的内联审批，以及原生端尚未验证。

附件上传、表情反应、提醒和旧 Core 专属斜杠命令尚未接通，界面不暴露无效控件。Android 真机、Mac 安装包、终端迁移前后延迟及完整视觉对照仍待验收。原始截图、测试输出和执行回执保存在忽略提交的 `.dev/bigbang/`；本路线图不把已有代码或单项测试通过视为整阶段完成。
