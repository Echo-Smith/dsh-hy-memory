# SDK 接入计划

按「先只读、后写入、最后演化」的顺序推进，每个阶段先做桥接连通测试，再接到插件和面板。

## 已验证的事实（不在计划里假装）

- 桥接必须复用已初始化的 `sdk_server._get_client()`。另起进程构造 `HyMemoryClient()` 读不到数据（实测 `list_memories` 返回 0 行，桥接同样查询返回 3 行）。
- 五个端点已在真实侧车连通：`update`、`history`、`stats_overview`、`metrics`、`recent_history`。
- `update` 真实生效，`history` 在编辑后记录 `UPDATE` 事件。

## 阶段一：记忆可编辑可审计（低风险，立刻可用）—— 已完成

目标：改一条记忆不用先删后建，并且能看见它被改过什么。

| 板块 | 接口 | 面板 | 完成标准 |
|---|---|---|---|
| 原地编辑 | `bridge/v1/update` | 个人记忆行的编辑改为走 update | ✅ 实测两次编辑累积 2 条 UPDATE；发现并修复了原路径 404 |
| 变更历史 | `bridge/v1/history` | 行详情里展示时间线 | 能列出每条事件的类型与前后内容 |
| 全局统计 | `bridge/v1/stats_overview` | 诊断卡显示三层真实计数 | 数字与 SDK 聚合一致，不再前端累加 |

## 阶段二：可观测性（让引擎行为可见）—— 已完成

目标：把"引擎在干什么"变成面板上能看懂的数字。

| 板块 | 接口 | 面板 | 完成标准 |
|---|---|---|---|
| 负载指标 | `bridge/v1/metrics` | 诊断卡显示请求数/失败数/延迟 | ✅ status 返回真实指标（completed/failed/active） |
| 操作历史 | `bridge/v1/recent_history` | 活动面板可切到「引擎事件」 | ✅ ADD/UPDATE/DELETE 事件流 |
| 全局统计 | `bridge/v1/stats_overview` | 诊断卡显示三层真实计数 | ✅ 1310 条，按场景分列 |

阶段二顺带修掉一个真缺陷：`status` 在 `describeModel()` 返回 null 时整体 500，导致面板全空。现在每个字段都做空值防护，并有测试锁住。

## 阶段三：会话叙事 —— 已完成

目标：会话结束时生成"这次做了什么"的摘要，而不是只有零散事实。

- 接口：`bridge/v1/finalize` → SDK `finalize_session`
- 触发：会话 dispose 时，每会话只跑一次
- 开关：侧车环境 `MEMORY_SESSION_EPISODE_ENABLED=1`（由 `narrative.enabled` 控制）
- 产出：L3_SUMMARY 层，面板会话区可展开查看
- 幂等：同一 (user, agent, session) 重复调用只更新同一个节点，重试不会重复。

### 实测记录（推翻了我最初的错误判断）

1. 最初在独立进程里直接构造 `HyMemoryClient()` 调用，得到 `no_raw_memories`，我据此判断"当前架构没有 L1_RAW，这条路走不通"。
2. 这个判断是错的。查询变更历史发现 `layer: l1_raw` 的记录有 198 条——原始对话一直都在，只是 `list_memories` 默认不返回 raw 层。
3. 改走桥接（复用侧车已初始化的客户端）后，错误变成 `disabled`——说明路径对了，只差开关。
4. 加上 `MEMORY_SESSION_EPISODE_ENABLED=1` 后返回 `status: complete`，`episode_id` 生成，L3_SUMMARY 层出现真实叙事。

结论写在这里，是因为以后还会有人犯同样的错：**判断 SDK 能力必须用桥接里那个已初始化的客户端，另起进程的结论一律不可信。**

## 不做（并说明原因）

| 方法 | 为什么不接 |
|---|---|
| `evolve` | ultra 模式专用、同步阻塞、token 成本高。需先单独测成本再决定 |
| `build_entity_store` | 内部构建细节，没有用户可感知的产出 |
| `clone_user` | 备份/迁移功能，应先做导出 JSON（已有）而不是克隆整库 |
| `lag_snapshot` / `run` / `stop` | 内部生命周期，插件已通过进程管理覆盖 |
| `delete_all` | 已有带确认的「彻底清除」，不需要第二个删除入口 |
| `add_extracted` | 绕过提炼直接写入，与"自动沉淀"的设计相悖 |

## 补充：个人画像（L0）—— 不需要 evolve，也不需要 ultra

起因是问「个人画像有没有做可视化」。查证结论：

- 代码里 `get_user_profile` 一次都没出现过，面板没有画像。
- 引擎里 `l0_basic_info` 和 `l4_identity` 都是 0 行，`get_user_profile` 返回 `profile: null`。

一度以为要用 `evolve`（ultra 模式专用）才能生成画像。**这个假设是错的**：

- pro 模式下 `evolve` 直接抛 `requires mode='ultra'`。
- 但读源码发现画像是在 **write 流程**里自动写的（`writer.py` 调用 `upsert_basic_profile`），条件是抽取结果里出现 `basic_info` 字段。
- 实测：写入一句「我叫 X，是一名独立开发者，常驻杭州」，立刻得到
  `{"name": "X", "occupation": "独立开发者", "location": "杭州"}`。

所以画像一直可用，只是**我们的对话里没出现过 `basic_profile` 默认字段**（姓名/年龄/城市/职业/雇主）。这不是缺陷，是抽取 schema 与使用场景不匹配。

已接入：`bridge/v1/profile` → 面板「个人」标签顶部的画像卡。字段名走 locale，未知字段原样显示。

## 画像时间戳 bug

`memory_at` 是 epoch **秒**，面板统一按**毫秒**渲染，于是 2026-11-10 显示成「56 年前」（1970）。
已在 `panel-api.js` 加 `toMillis()`：小于 1e11 视为秒并乘以 1000，否则原样。画像和会话叙事两处都用了。

## 开发者画像 schema：实测结论（未达预期，已如实记录）

目标是把画像字段从 SDK 默认的 name/age/location/occupation/employer 换成开发者关心的技术栈。

**做了什么**：在桥接里替换 `MemoryConfig.from_env`，注入 7 个开发者字段（name/role/location/languages/frameworks/tools/platforms）。已验证 schema 确实进入运行中的侧车（`/bridge/v1/schema` 返回新字段及描述）。

**结果**：抽取只填 `name` 和 `location`，技术栈类字段始终不填。

**排查过程与结论**：
1. 一开始以为要用 `evolve` + ultra 模式 —— 错，画像根本不走那条路。
2. 又以为 schema 没生效 —— 错，探针证明生效了。
3. 读源码发现两个反转：早期版本用 function-calling 工具写画像，v0.3.45 又改回 extractor 直接返回 `basic_info`（理由是「弱模型乱填」）。
4. 最终定位：extractor 的规则文本把画像示例限定为 name/age/location/occupation/employer，当前记忆模型据此只填这几个最直白的字段。

**处置**：schema 保留（成本为零，换更强的模型会自动受益），但代码注释和本文件都写明了它的实际效果，不假装它已经能用。面板不做额外承诺。

**若要让画像真正包含技术栈**，可选方向（均需单独验证成本）：
- 换更强的记忆模型；
- 写入时并行跑一次专门的画像抽取调用（多一次模型成本）；
- 从已有的个人层记忆里用规则/LLM 汇总，而不是依赖写入时的机会性抽取。

## 专门画像抽取 —— 已完成并实测

按「会话结束触发 + 最近 50 条 + 写入引擎 L0」实现。

**实测成本**：13 条记忆 → 约 810 tokens（410 输入 + 400 输出），1.9 秒。约等于一次普通写入的 30%。
输入随语料增长，因此读取上限固定在最近 50 条。

**效果对比**（同一批记忆）：

| 路径 | 产出字段 |
|---|---|
| 引擎机会性抽取 | name、location（有时加 occupation） |
| 专门抽取一次 | name、role、location、languages、frameworks、tools、platforms、conventions |

已写入 L0，与原有字段增量合并（diff 更新，不覆盖）。

**实现要点**
- `bridge/v1/profile_upsert` 复用 `upsert_basic_profile`，因此版本链、diff、supersedes 与引擎自动路径一致。
- 每会话只跑一次（`state.profileRefresh.sessionId` 去重）。
- 与叙事是两个独立开关：关掉 `narrative.enabled` 不影响画像刷新。
- 模型回复用最宽松的方式解析（找第一个 `{` 到最后一个 `}`），只保留已知键，未知键丢弃。

