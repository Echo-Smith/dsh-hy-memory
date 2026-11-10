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
