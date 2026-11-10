# Bigbang 例行巡检（Routines）与 Playbook 方案

状态：方案，未实施（2026-11-08）。建立在 [Chat 协调](bigbang-chat.md) 的账本、持久聊天会话与助手机器归属之上。

## 目标

让常驻在 Spark（或在线 member）上的 Chat 助手像真正的常驻队友一样工作：

- **例行巡检（Routines）**：按定时（cron）唤醒指定助手，在绑定的私聊或群聊里执行检查、汇总或日常维护；无事发生时静默跳过，有实质结果或异常时才发消息并推送通知。
- **操作手册（Playbooks）**：用户带助手走通一次任务（网页操作、手机操作、代码巡检或排障）后，助手把步骤固化到自己 home 下的 `playbooks/` 目录，后续对话和 Routine 直接按手册复用。

## 为什么不用 Paseo 自带的 Schedule

Paseo 的定时任务（`packages/server/src/server/schedule/`）面向独立工作区 Agent，每次运行在工作区里产生编码记录，没有 Bigbang 助手身份、不进 `chat.sqlite` 账本，也不具备聊天会话里的 `(pass)` 静默、群聊路由、Mailbox 互问和跨机接管能力。因此助手的例行巡检由协调器账本直接管理，复用该助手在目标会话中已绑定的持久执行 Agent。

## 例行巡检（Routines）

### 账本与归属

协调器 `chat.sqlite` 新增 `routines` 表：

| 字段             | 含义                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `id`             | Routine 唯一标识                                                      |
| `assistantId`    | 执行巡检的助手；巡检回合在该助手绑定的机器上运行                      |
| `conversationId` | 绑定的私聊或群聊；产出的消息与任务卡落在这里                          |
| `threadId`       | 可选固定线程；为空时直接发在会话主线                                  |
| `title`          | 简短名称（如“早间邮件与日程汇总”“主分支构建巡检”）                    |
| `prompt`         | 巡检指令，可直接引用 `playbooks/<name>.md`                            |
| `cron`           | 5 段 cron 表达式                                                      |
| `timezone`       | IANA 时区（默认协调器本机时区）                                       |
| `enabled`        | 是否启用                                                              |
| `lastRunAt`      | 上次触发时间、结果状态（`replied` / `passed` / `failed` / `skipped`） |
| `nextRunAt`      | 下次计划触发时间戳                                                    |

### 触发与回合（`kind: "routine"`）

1. **单次排队，不补跑积压**：协调器调度器到期时推进 `nextRunAt`。若协调器关机重开或同一 Routine 的上一轮还在排队/运行，错过的周期合并为一次触发，不连续补跑历史周期。
2. **复用会话执行**：协调器在 `(conversationId, threadId, assistantId)` 对应的持久聊天会话中入队一个 `kind: "routine"` 的回合，提示词标明当前是定时巡检 `[Routine: <title>]` 及当前时间。若该助手正在同一会话回复用户，Routine 回合排在后面，不打断用户对话。
3. **成员机器离线**：若助手绑定在 member 机器且触发时该机器离线，本次运行直接记为 `skipped (host_offline)`，不在聊天里刷报错气泡；支持可选配置“连续离线失败提醒”。
4. **静默规则（`(pass)`）**：与群聊 `awareness` 回合（[bigbang-chat.md](bigbang-chat.md#a-turn)）一致，当巡检结果正常、无需打扰用户时，助手只回复 `(pass)`。协调器收到 `(pass)` 后只把本次 Routine 记为 `passed`，不在会话里提交消息，也不发推送通知。
5. **汇报与行动**：当有实质结论或发现异常时，助手输出正文作为 `final` 消息提交到会话，并触发移动端/桌面端后台通知。若助手已开启自主任务、浏览器、手机或 Mailbox 权限，Routine 回合内可照常调用 `bigbang-start_task`、`bigbang-browser_*`、`bigbang-phone_*` 或 `bigbang-send`；遇到审批或接管（Takeover）时按原会话流程通知用户。

## 操作手册（Playbooks）

每个助手在自己所属机器的 home 目录下维护 `playbooks/` 文件夹（与 `MEMORY.md`、`notes/` 同级，位于 `$PASEO_HOME/bigbang/assistants/<assistantId>/playbooks/`）：

- **怎么生成（“Show-Me” 沉淀）**：用户在聊天或接管过程中带助手做完一件事后，说“把刚才的流程存成 playbook”，助手用自己的文件工具把目标、前置条件、具体步骤、判断标准和“何时调用 `hand_to_user` 交用户处理”写成 `playbooks/<slug>.md`。
- **怎么发现与使用**：助手的系统提示词与 `MEMORY.md` 索引约定一起说明 `playbooks/` 的用途。每当用户要求执行某类常规事务或 Routine 触发时，助手先读对应的 `playbooks/<slug>.md` 按步骤执行；执行中若发现页面结构变化或用户纠正了做法，助手更新该文件。
- **跨机读写**：与 `MEMORY.md` 相同，协调器上的助手直接读写本机文件，member 机器上的助手经扩展后的 `member.memory.*` / `member.playbook.*` 供客户端查看与编辑。

## 工具与界面

### 助手工具（`bigbang-routine_*`）

助手在聊天回合中可管理自己名下、当前会话里的 Routine，因此用户可以直接在聊天里说“每天早上 9 点按 `playbooks/daily-check.md` 帮我看一下，有事叫我”：

| 工具             | 作用                                                           |
| ---------------- | -------------------------------------------------------------- |
| `routine_list`   | 列出当前助手在本会话（或名下全部）的 Routine 及最近运行状态    |
| `routine_save`   | 在当前会话新建或更新一条属于自己的 Routine（校验 cron 与时区） |
| `routine_delete` | 删除一条属于自己的 Routine                                     |

授权由协调器按账本校验：调用者只能操作 `assistantId` 为自己且自己仍是成员的会话中的 Routine；Routine 回合自身运行期间不允许递归新建 Routine。

### 界面

- **助手面板**：在助手的 Memory 标签页旁新增 **Routines** 与 **Playbooks** 管理入口，支持手动新建/编辑 Routine、开关、点“立即运行一次”，以及查看每次触发是静默（`passed`）、已发言（`replied`）还是失败（`failed`）。
- **聊天消息标记**：由 Routine 产出的聊天消息带简短标记（如 `Routine · 早间汇总`），区分于用户提问触发的普通回复。

## 分阶段

| 阶段             | 内容                                                                                   | 验收                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| T0 账本与调度    | `routines` 表、cron 调度器、`kind: "routine"` 回合、`(pass)` 静默、跳过离线与防积压    | 到点自动运行：回复 `(pass)` 时聊天无新气泡且记录为 `passed`；有正文时正常出现在聊天里；daemon 重启后不丢调度也不重复跑 |
| T1 工具与界面    | `bigbang-routine_*` 助手工具、UI 中的 Routines 列表/开关/立即运行、消息标记            | 在私聊中让助手“创建一条定时巡检”，UI 列表同步显示，点“立即运行”可走通完整回合                                          |
| T2 Playbook 闭环 | 助手 home 下 `playbooks/` 初始化、提示词引导、UI 查看与编辑 Playbook（含 member 机器） | 带助手跑通一次网页/工作区检查后让其保存为 Playbook，随后由 Routine 引用该 Playbook 独立执行成功                        |

## 待定

1. **外部 Webhook 触发**：除定时 cron 外，是否在同一套 Routine 模型上支持带签名 token 的本地/局域网 HTTP 触发（如 GitHub Actions 或家庭自动化回调）。
