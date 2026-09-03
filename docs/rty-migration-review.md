# RTY SAP 迁移评审台账

## Scope

本次评审覆盖当前工作区的 RTY 后端 API、MongoDB 索引、前端 API/类型/筛选/详情/导出、Mock 数据，以及新增 RTY 集成测试和维修客户回填脚本。RTY 的唯一口径为 2026 年 SAP 工位记录中的去重 `PCODE`，故障来自 2026 年维修记录中与投入 SN 的交集。

## Findings

| ID | 严重度 | 问题/证据 | 处理 | 验收条件 |
|---|---|---|---|---|
| RTY-001 | P1 | 前端仍发送已废弃的 `model`、`customer`、`stat_method` 参数，且筛选类型保留客户维度 | 已修复：统一 `buildStationQuery`，收敛前后端类型和 Mock | 前端请求仅包含 RTY vNext 参数；`npm run lint` 通过 |
| RTY-002 | P1 | 维修明细与 SN 查询使用固定 `to_list` 长度，超限时静默返回不完整结果 | 已修复：Mongo 侧日期过滤；超过 SN/明细上限返回 `413` | 超限测试断言 `413`，响应不伪装成功 |
| RTY-003 | P1 | RTY 故障 SN 在 Python 侧过滤维修日期，无法充分使用索引 | 已修复：网关批量接口下推 `PCODE` 与维修日期范围，并由网关集合索引执行 | 网关 Explain 显示日期范围和 PCODE 查询计划已审查 |
| RTY-004 | P1 | 分组内 `$first` 未定义顺序，重复过站可能导致展示字段不稳定 | 已修复：分组前按 `GSTRS/PCODE` 排序 | 相同数据重复运行返回稳定订单/机型/日期 |
| RTY-005 | P2 | 路由仍承载较多聚合与 DTO 逻辑，后续扩展成本较高 | 保留为下一迭代：抽离 `rty_service`/repository | 路由仅负责参数、鉴权和响应；服务层有独立单测 |
| RTY-006 | P2 | 全量 Ruff 仍有既存 20 项问题，运行时有 Pydantic 弃用警告 | 不阻塞本次 RTY 合并，单独建立质量债务任务 | 后续迭代清零并纳入 CI |
| RTY-007 | P2 | 前端生产包 JS 首包约 1.39 MB | 不阻塞本次功能迁移；后续按页面路由拆包并设包体预算 | 首屏 chunk 低于团队预算，构建不产生超预算告警 |

## Verification Evidence

- `npm run lint`：通过。
- `npm run build`：通过；当前仍提示首包大于 500 KB。
- 变更相关 Ruff：通过。
- RTY 单元/集成测试：10 项通过。
- 全量 Ruff 的既存问题和本地 Pydantic 警告未作为本次变更的新增回归。

## Performance Gate

在脱敏、生产量级数据上执行：

```bash
uv run --project backend python scripts/maintenance/benchmark_rty.py \
  --mongo-url "$MONGODB_URL" --database "$MONGODB_DB_NAME"
```

记录默认查询、销售订单、生产订单、基地/机型、SN 和维修明细查询的 `executionStats` 与重复执行耗时。合并前要求 50 条首屏请求 P95 不超过 1 秒；任何 `COLLSCAN` 必须在台账中解释并有替代索引或明确豁免。
