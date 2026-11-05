# dsh-new-session

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](./package.json)

`dsh-new-session` · 给 DeepSeek Harness 的「新开对话」工具

**仓库：** <https://github.com/CassiaTw1g/dsh-new-session>

让 DeepSeek Harness 里的模型**真的能新开一段对话**：在当前工作区建一个会话、把交接任务作为首条消息投进去、顺手带上一段对话的只读引用，然后把 Web UI 自动切到新对话 —— codex 里“说一句就新开一段”的那套手感。

> 起因：DSH 0.2.1 里模型只能回“新对话我开不了，那是界面操作”。其实宿主有完整的建会话通路（`sessionController.commands.create` + `commands.prompt`，就是左侧栏「新对话」按钮走的那条），只是没有暴露成工具。这个插件把它补上。

<details>
<summary><b>English</b></summary>

`dsh-new-session` gives the model inside DeepSeek Harness a real `new_conversation` tool: it creates a session in the current workspace, delivers a self-contained handoff as the first user message, optionally attaches a read-only `dsh-session:` snapshot of the calling conversation, pins the title with a `user` source, and the web client switches the view to the new session automatically.

- Same feel as “start a new chat and keep going” in codex — say it, the new session exists.
- Zero `@deepseek-ai/*` imports on the host side, so it does not care about your host's minor version.
- MIT.

```bash
dsh plugin --profile desktop add dsh-new-session   # or: node tools/install-profile.mjs --profile desktop
```

</details>

## 它做什么

| 能力 | 说明 |
| --- | --- |
| `new_conversation` 工具 | 参数：`prompt`（必填，交接内容）、`title`、`workspace`、`reference_current`、`switch` |
| 建在当前工作区 | 默认落在当前会话所属工作区（`workspaceRegistry`），侧边栏里直接出现，不是一个孤儿会话 |
| 首条消息即开工 | 新会话立刻跑自己的第一轮，调用方不等它结束 |
| 上下文交接 | `reference_current: true`（默认）会在首条消息里附 `dsh-session:` 引用，宿主把本对话的只读快照投给新会话；不给它引用时，`prompt` 必须自包含 |
| 钉标题 | `title` 通过 `session/title` 的 `user` 来源钉住，自动标题（fallback / LLM）不会再盖掉 |
| 自动切换 | 结果落地后调 `uiWorkspace.openSession(sessionId)`，主视图跳到新对话；3 分钟内的新卡片才自动跳，翻历史不会被抢视图；同一个会话只跳一次 |
| 中文/英文卡片 | 工具行渲染成「新开对话」卡片：标题、工作区、session id、打开按钮；失败时显示原因 |

## 安装

### 方式 0：npm / 插件市场（最省事）

```bash
dsh plugin --profile desktop add dsh-new-session
```

或者直接在 DSH 的「插件 → 发现」里搜 `new session`（上架索引后可见）。桌面版要先完全退出，`dsh plugin` 才能拿到 profile 锁。

从 GitHub 装（npm 还没发布、或想跟主干）：

```bash
git clone https://github.com/CassiaTw1g/dsh-new-session.git
dsh plugin --profile desktop add file:D:/path/to/dsh-new-session
```

### 方式 A：本仓库脚本（推荐，桌面版运行中也能装）

```bash
node tools/install-profile.mjs                      # 默认 desktop profile
node tools/install-profile.mjs --profile headless   # 其它 profile
node tools/install-profile.mjs --dry-run            # 只看会做什么
node tools/install-profile.mjs --profile desktop --rollback   # 撤销
```

脚本只做文件级安装（复制包 + 改 `package.json` 的 `dependencies` 与 `dsh.profile.bundles`），每次都留 `package.json.bak-newsession-<时间戳>` 备份。

装完：

1. **宿主半边**：桌面版会通过 profile 热重载直接挂上新工具（我这边是秒级生效）；如果没生效，完全退出 DSH 再打开。
2. **浏览器半边**：刷新一次页面（`dsh.client` 的模块图在页面加载时组装）。

### 方式 B：`dsh plugin`

```bash
dsh plugin --profile desktop add file:D:/DSH/插件/dsh-new-session
```

桌面版要先完全退出，`dsh plugin` 才能拿到 profile 锁。

## 配置

`cordis.patch.yml` 里那几行就是全部配置：

```yaml
- insert:
    - id: new-session
      name: dsh-new-session
      config:
        autoSwitch: true        # 结果落地后自动切到新对话
        referenceCurrent: true  # 自动附加上一段对话的只读引用
        switchDelayMs: 900      # 切换前的停顿（毫秒）
        # toolName: new_conversation
```

工具参数里的 `switch` / `reference_current` 会覆盖单次调用的行为。

## 用法

直接跟模型说：

> 新开一个对话，把 X 剩下的事继续做完。

模型会调 `new_conversation`，写一段自包含的交接（目标、已完成、下一步、约束、路径），新会话立刻开工，界面切过去；旧会话保持原样，随时可以切回来。

## 和已有插件的关系

社区里已经有两个相近的东西（我查过 npm / GitHub）：

- [`@ryuu-64/dsh-session-tools`](https://www.npmjs.com/package/@ryuu-64/dsh-session-tools)：`session_create` / `session_send` / `list_sessions` / `session_wait`，功能很全，但 peer 依赖钉在 `0.2.0-rc.2`，且建会话是“卡片 + 手动点开”。
- [`dsh-session-messaging`](https://www.npmjs.com/package/dsh-session-messaging)：会话间互发消息，没有建会话。

这个插件的差异点：**自动切换**（codex 手感）、**内置跨对话引用**、**零 `@deepseek-ai/*` import**（不挑宿主小版本，装进任何 0.2.x profile 都不会因为 peer 解析失败而挂）。

## 已知边界

- 浏览器半边只对 Web / 桌面版有意义；headless profile 没有 `sessionController`，工具会给出可读报错。
- 跨对话引用依赖宿主装了 `@deepseek-ai/dsh-session-reference`（`dsh-web-app` 默认带）；没有这个服务时自动降级为纯文本交接。
- 只建会话，不建工作区；`workspace` 写错会报错并列出可选工作区。
- 自动切换不会把用户从正在看的别的会话抢走 —— 卡片只出现在“发起调用的那段对话”里。

## 自测

```bash
node --test test/host.test.mjs test/client.test.mjs
```

16 组断言：配置归一化、工作区解析、引用编码、preset 失效回退、首条消息被拒的报错、卡片状态、自动切换的一次性/时间窗、失败不跳转。

## 目录

```
lib/index.js                宿主半边：工具定义 + 建会话/投递/钉标题
lib/client.js               浏览器半边：工具行卡片 + 自动切换
cordis.patch.yml            bundle 行（默认配置）
tools/install-profile.mjs   安装 / 回滚脚本
test/host.test.mjs          宿主单测（假 ctx，无宿主依赖）
test/client.test.mjs        浏览器单测（假 React + 假模块表）
```

## 实测记录（本机 desktop profile）

- 工具通过 profile 热重载挂上，无需重启桌面版；
- 新建 `session-…` 落在 `D:\DSH\插件`，日志里能看到 `user/message`（交接正文）+ `session-reference` 快照，并跑完 `turn/end`；
- `title` 以 `session/title`（`source.kind = "user"`）钉住，自动标题不再覆盖。
