# SDK 接入计划

按「先只读、后写入、最后演化」的顺序推进，每个阶段先做桥接连通测试，再接到插件和面板。

## 已验证的事实（不在计划里假装）

- 桥接必须复用已初始化的 `sdk_server._get_client()`。另起进程构造 `HyMemoryClient()` 读不到数据（实测 `list_memories` 返回 0 行，桥接同样查询返回 3 行）。
- 五个端点已在真实侧车连通：`update`、`history`、`stats_overview`、`metrics`、`recent_history`。
- `update` 真实生效，`history` 在编辑后记录 `UPDATE` 事件。

## 阶段一：记忆可编辑可审计（低风险，立刻可用）

目标：改一条记忆不用先删后建，并且能看见它被改过什么。

| 板块 | 接口 | 面板 | 完成标准 |
|---|---|---|---|
| 原地编辑 | `bridge/v1/update` | 个人记忆行的编辑改为走 update | 编辑后内容变化、id 不变、history 多一条 UPDATE |
| 变更历史 | `bridge/v1/history` | 行详情里展示时间线 | 能列出每条事件的类型与前后内容 |
| 全局统计 | `bridge/v1/stats_overview` | 诊断卡显示三层真实计数 | 数字与 SDK 聚合一致，不再前端累加 |

## 阶段二：可观测性（让引擎行为可见）

目标：把"引擎在干什么"变成面板上能看懂的数字。

| 板块 | 接口 | 面板 | 完成标准 |
|---|---|---|---|
| 负载指标 | `bridge/v1/metrics` | 诊断卡显示请求数/失败数/延迟 | 与 `get_metrics` 返回值一致 |
| 操作历史 | `bridge/v1/recent_history` | 「写入活动」改用真实历史 | 显示 ADD/UPDATE/DELETE 事件流 |

## 阶段三：会话叙事（需要设计）

目标：会话结束时生成"这次做了什么"的摘要，而不是只有零散事实。

- 接口：`finalize_session(user_id, agent_id, session_id, language)`
- 触发：会话 dispose 时
- 风险：会调用一次模型，需要确认成本；且叙事本身也是一条记忆，要避免无限递归。

## 不做（并说明原因）

| 方法 | 为什么不接 |
|---|---|
| `evolve` | ultra 模式专用、同步阻塞、token 成本高。需先单独测成本再决定 |
| `build_entity_store` | 内部构建细节，没有用户可感知的产出 |
| `clone_user` | 备份/迁移功能，应先做导出 JSON（已有）而不是克隆整库 |
| `lag_snapshot` / `run` / `stop` | 内部生命周期，插件已通过进程管理覆盖 |
| `delete_all` | 已有带确认的「彻底清除」，不需要第二个删除入口 |
| `add_extracted` | 绕过提炼直接写入，与"自动沉淀"的设计相悖 |
