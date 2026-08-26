# 数据采集脚本

完整的安装、首次同步、增量同步、定时任务和故障排查说明见
[`docs/sync-scripts.md`](../docs/sync-scripts.md)。本文件只保留脚本职责索引。

## 推荐运行流程

RTY（SAP 销售订单 + 维修记录补全）统一使用 `sync_rty_incremental.py`：

```bash
cd /Users/libiao/Desktop/github/QualityMonitoringSystem

# 首次迁移：SG、KK 均成功后分别建立水位线
uv run --project backend python scripts/sync_rty_incremental.py \
  bootstrap --start-date 2026-01-01

# 每日增量（默认回看 7 天）
uv run --project backend python scripts/sync_rty_incremental.py run
```

可选参数：`--only sales|repair`、`--dry-run`、`--lookback-days N`。
产品层次从 `RTY_SYNC_PRODH_LIST`（逗号分隔，默认 `00100`）读取，锁文件从
`RTY_SYNC_LOCK_PATH` 读取。任务输出 JSON；任一来源失败返回非零退出码。
水位线在 `rty_sync_checkpoints`，运行审计在 `rty_sync_runs`。

SCS DOA 只使用 `sync_scs_incremental.py` 作为调度入口。它同时支持首次同步和后续增量同步：

```bash
cd /Users/libiao/Desktop/github/QualityMonitoringSystem

# 首次同步：历史集合为空时必须提供起始日期
SCS_USERNAME='账号' SCS_PASSWORD='密码' \
uv run --project backend python scripts/sync_scs_incremental.py \
  --start-date 2026-01-01

# 后续定时增量：从 MongoDB 水位线继续，必要时回看当天/前一天
SCS_USERNAME='账号' SCS_PASSWORD='密码' \
uv run --project backend python scripts/sync_scs_incremental.py \
  --lookback-days 1 --retry-failed
```

如果数据库中已经存在旧版 DOA 数据且尚未生成 `scs_key`，首次运行时追加
`--migrate-keys`；该选项会合并旧重复记录，执行前应先备份。首次同步成功后，
`--start-date` 不再需要。水位线保存在
`scs_doa_incremental_progress`，只有列表和详情补采全部成功才会推进。
使用 cron、systemd timer 或其他调度器时，只调度上面的增量命令；脚本自身带有单实例锁。

## 文件职责

| 文件 | 类型 | 用途 |
|---|---|---|
| `sync_scs_incremental.py` | **日常入口** | SCS DOA 首次同步、增量同步、详情补采、失败重试 |
| `scs_sync_lib.py` | 内部模块 | SCS 登录、日期查询、稳定键、水位线、幂等写入和进程锁 |
| `enrich_scs_doa_sales_orders.py` | 内部模块/兼容入口 | 产品实体详情解析和补采函数；被增量入口导入。单独运行只用于历史数据补采，不纳入定时任务 |
| `spider_scs.py` | 兼容模块/旧入口 | 提供 DOA 页面解析和请求函数，也被其他脚本复用。旧的全量 CLI 不应再作为日常任务运行 |
| `maintenance/migrate_scs_doa_keys.py` | 一次性维护 | 为历史 DOA 数据生成 `scs_key` 并清理旧重复记录。优先使用增量入口的 `--migrate-keys` |
| `sync_rty_incremental.py` | **RTY 日常入口** | SAP 销售订单水位线增量 + 维修订单/客户补全 |
| `maintenance/sync_sales_orders_range.py` | 兼容旧入口 | 历史按日期范围同步；不应再用于日常调度 |
| `spider_change_result.py` | 独立业务入口 | SCS 换件登记同步到 `scs_change_results`，与 DOA 查询接口和水位线不同，不合并 |
| `maintenance/backfill_repair_orders.py` | 一次性维护 | 按维修记录 `PCODE` 回填 `repair_records_sap` 的生产订单和销售订单；默认只统计，传 `--apply` 才写库 |
| `maintenance/backfill_repair_orders_from_sap_sn.py` | 一次性维护 | 合并缺失订单字段的 SN，分批调用 SAP `ZSIMS_CL_INBOUND_SN_INFO` 回填；默认只统计，传 `--apply` 才写库 |
| `maintenance/backfill_repair_customers.py` | 一次性维护 | 按生产订单回填维修记录客户；已由 RTY 统一同步任务覆盖 |
| `maintenance/benchmark_rty.py` | 手工诊断 | 只读 RTY 查询性能与执行计划基准 |

## 迁移和清理说明

- `maintenance/migrate_scs_doa_keys.py` 是一次性维护脚本，不应放进定时任务。已有数据出现重复键时，先备份并运行一次；正常情况下直接使用 `--migrate-keys` 即可。
- `spider_scs.py` 和 `enrich_scs_doa_sales_orders.py` 目前仍被其他模块导入，不能直接删除。它们可以在后续重构中移动到 `scripts/lib/`，但不影响当前调度流程。
- RTY 日常任务不包含 SCS、换件登记或工位影像同步；这些链路保持原样。
- RTY 增量任务按 SG/KK 来源独立推进水位线。单来源失败时，成功来源仍写入并推进，失败来源下次从旧水位线回看 7 天重试。
- `maintenance/sync_sales_orders_range.py` 与 `spider_change_result.py` 访问不同 SCS/SAP 数据源，强行合并会让失败重试、水位线和凭据配置相互耦合，保持独立更安全。
- `maintenance/backfill_repair_orders.py` 仅填充空的 `AUFNR`、`VBELN`，不会覆盖原始订单号。它会把来源和冲突候选值写入 `order_backfill`，并在 `repair_order_backfill_runs` 记录实际执行摘要。先运行默认 dry-run，确认统计后再传 `--apply`。
- `maintenance/backfill_repair_orders_from_sap_sn.py` 会先合并两个字段缺失记录的唯一 `PCODE`，再按批次同时请求 SG/KK，避免同一 SN 重复调用。实际执行摘要写入 `repair_sn_api_backfill_runs`。
- `maintenance/backfill_repair_customers.py` 仅保留历史手工补数兼容能力；日常任务使用 `sync_rty_incremental.py run`，避免重复维护两套回填逻辑。
- `maintenance/benchmark_rty.py` 只读数据库，供迁移评审或性能回归时手工运行。
- `scripts/__pycache__/`、`.DS_Store` 等本地生成文件不属于源码，不要提交。

## 常用检查

```bash
# 检查增量任务是否存在重复稳定键
uv run --project backend python -m compileall scripts

# 查看 DOA 增量水位线
db.scs_doa_incremental_progress.findOne({ _id: 'scs_doa_incremental' })
```
