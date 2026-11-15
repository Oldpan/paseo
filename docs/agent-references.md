# Agent 开发参考技术文

收集与 Agent 架构、长时运行、调度、记忆、人机协同及工程实践相关的外部技术文章，用于后续设计评审与开发参考。

## 目录

| 文章                                                                                         | 来源      | 主题                             | 收录日期   |
| -------------------------------------------------------------------------------------------- | --------- | -------------------------------- | ---------- |
| [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents) | Anthropic | 常驻 Agent、唤醒原语、状态持久化 | 2026-11-15 |

---

## Building always-on agents

- **链接**：https://claude.com/resources/articles/building-always-on-agents
- **来源**：Anthropic（Claude Resources）
- **收录日期**：2026-11-15

### 核心要点

1. **“Always-On” 的本质是 Sleep / Wake 循环**：常驻 Agent 并非 24/7 持续运行并消耗 token，而是大部分时间处于休眠状态，由定时调度、Webhook 或异步事件唤醒执行一次 **run**，完成后持久化状态并回到休眠。
2. **三大核心基础设施原语**：
   - **何时唤醒（When agents wake up）**：触发器、定时任务（cron）与事件钩子（event hooks）。
   - **跨运行延续什么（What carries over between runs）**：持久化记忆、工作区文件与会话记录（session transcripts），解决多会话交接时上下文丢失的问题。
   - **工作成果如何触达用户（How work reaches the user）**：通知、审批门控、收件箱/看板展示，以及 Agent 判断“何时应向人类汇报或升级确认”的能力。
3. **推理循环与执行环境解耦**：将 LLM 推理与会话队列和实际执行环境（代码沙箱、终端、浏览器、文件系统）解耦，同时保证沙箱/工作区存储跨休眠周期持久化，不因单次 run 结束而丢失工作成果。

### 对本项目的启发

- **唤醒与静默**：对应 [pavra-routines.md](pavra-routines.md) 的定时巡检与 `(pass)` 静默机制——按需唤醒、无事不打扰用户。
- **状态与记忆延续**：对应 [pavra-chat.md](pavra-chat.md) 的账本/执行分离以及助手独立持久化记忆（`MEMORY.md`、`notes/`、`playbooks/`）。
- **成果触达与人机协同**：对应 [pavra-roadmap.md](pavra-roadmap.md) 中的四段式收件箱、后台本地通知以及审批/接管挂起机制。
