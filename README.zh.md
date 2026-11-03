# hy-memory4dsh

[English](README.md) | 中文

> 给 DSH 装上三层长期记忆：会话、项目、个人。

## 它解决什么

DSH 本身没有长期记忆。`AGENTS.md` 是手写的静态规则，会话历史只在当前会话里有效，一换会话，你上次讲过的约定、偏好、踩过的坑就都要重讲一遍。hy-memory4dsh 把这些东西自己攒下来，在对话开始前挑相关的注入，在回合结束后自动沉淀，跨会话、跨项目可用。

## 怎么实现

插件跑在 DSH 里，记忆内核用 Hy-Memory 2.0 的 Python SDK，通过一个自带 venv 的 sidecar 进程运行，不需要你单独起服务。

- **召回**：`agent/pre-step` 钩子里按「个人层 + 当前项目 + 当前会话」三路检索，命中后以一条标注了来源的 user 消息注入，告诉模型这是背景资料、可能过时、不是指令。
- **捕获**：监听会话事件，攒够一个窗口后把对话与工具调用一起交给 sidecar 提炼，按场景写入 chat / working / coding 三套存储。
- **晋升**：会话记忆定期提炼成项目约定，项目约定再提炼成个人偏好，形成「会话 → 项目 → 个人」的沉淀链。
- **存储**：全部在 `$DSH_HOME/integrations/hy-memory/` 下，模型直接沿用你在 DSH 里配好的路由，嵌入默认用本地 ONNX，也可以换成远端。

## 功能

- 三层记忆：个人长期、项目、项目内会话，面板分页浏览、搜索、编辑与删除。
- 三场景：chat 常态写入；working / coding 走独立的 productivity 存储，用 workspace id 检索。
- 自动召回与捕获，含工具调用轨迹（调用了什么、结果是什么）。
- 设置 > 记忆 面板：个人页与「项目与会话」页、项目选择器、独立分页、总开关、记忆占用估算。
- MemHub 共存：检测本地 MemHub、导出、拉取（运行时占用会明确拒绝）、从文件导入并去重。
- 跨项目检索：需要时对每个项目分别检索再合并，日常召回不会混入别的项目。
- 手动记忆：`memory_add` 按内容自动判断写个人还是项目，也能显式指定层级。
- 检查更新与 GitHub 入口在面板底部。

## 依赖

本仓库只包含 DSH 这一侧：宿主插件、客户端面板、bridge 脚本与文档。**Hy-Memory 2.0 框架本体不在仓库里**。首次使用时，插件会在 `$DSH_HOME/integrations/hy-memory/venv` 下创建 Python 环境，并把 PyPI 包 `hy-memory` 装进去，bridge 再从该环境导入 `hy_memory`。

- 需要联网一次完成安装（可选开启的本地嵌入模型也需要下载）。
- 按包名安装，新环境默认取当时最新版；安装时设置 `HY_MEMORY_SDK_PACKAGE=hy-memory==<版本>` 可以锁定版本。
- 上游代码及其许可归 Hy-Memory 项目所有，本仓库只依赖、不重分发。
- 本仓库其余部分的许可是 MIT。

## 安装

```bash
dsh plugin --profile desktop add link:$(pwd)
```

然后打开 设置 > 记忆。首次使用会自动准备 Python 环境，模型沿用 DSH 已配的路由，不需要额外填 key。

要求：DSH 0.2 预览版、Python 3.10+（首次会自动装到插件目录）、可选 git（用于取 workspace id）。

## 截图

| 个人记忆 | 项目与会话 | 更新检查 |
|---|---|---|
| ![个人](docs/screenshots/panel-personal.png) | ![项目与会话](docs/screenshots/panel-workspace.png) | ![更新](docs/screenshots/panel-update.png) |

MemHub 未安装时：[虚线卡片](docs/screenshots/panel-memhub-absent.png)

## 兼容与边界

- 项目记忆绑定项目；会话记忆跟随它创建时所在的项目，换项目看不到。
- working / coding 的存储只有带 workspace id 的检索才可见，因此捕获默认走 chat 库，只有显式打开 productivity 才分流。
- 模型故障期间 reconcile 会失败，写入会重试；彻底失败时把原文留在原始层并在活动里记录。
- 本地嵌入是英文模型，中文检索靠语义加词面兜底；换远端多语言嵌入会更好。

## 怎么验证改动

```bash
npm run check         # 入口与构建产物的语法检查
npm test              # 85 个宿主测试
npm run test:smoke    # 面板冒烟，读取构建后的 client.js
npm run eval:recall   # 离线召回夹具：命中、噪声、预算、注入体积
```

对着运行中的 sidecar 跑真实链路，输出命中率、注入体积与延迟：

```bash
npm run eval:live -- --port <sidecar 端口> [--grid]
```

当前在真实 store 的十个问题上：命中 9/10，平均注入 941 字，平均 149 毫秒。补上 session id 与会话层、以及预算感知的词面补齐之前，是 6/10、805 字。

CI 在每次 push 和 PR 上跑同样四条命令。召回评测已经抓到一个真实问题：单条超长记忆会绕过 `maxChars` 被整条注入。

后续计划按顺序写在 [docs/ROADMAP.md](docs/ROADMAP.md)：真实数据夹具、多语言嵌入、生命周期与去重、可解释召回、隐私开关、MemHub 自带同步、场景验证与运维。

## 参与

欢迎提 issue 和 PR。复现步骤、版本、日志（`$DSH_HOME/integrations/hy-memory/sidecar.log`）能省很多时间；改动请附带测试或可复现的验证方式。

## 许可

MIT
