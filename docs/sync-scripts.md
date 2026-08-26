# 同步脚本使用说明

本文档说明 `scripts/` 目录下数据同步脚本的安装、首次同步、增量同步、失败重试和定时执行方式。

## 1. 脚本职责

| 脚本 | 数据源 | 目标集合 | 使用频率 |
|---|---|---|---|
| `sync_scs_incremental.py` | SCS DOA | `scs_doa_results` | 首次同步和日常定时任务 |
| `sync_rty_incremental.py` | SAP SG/KK + MongoDB 维修记录 | `sales_orders_sap`、`repair_records_sap` | RTY 首次同步和日常定时任务 |
| `maintenance/sync_sales_orders_range.py` | SAP SG/KK | `sales_orders_sap` | 兼容旧入口，不用于日常调度 |
| `spider_change_result.py` | SCS 换件登记 | `scs_change_results` | 首次同步、补页或定期重抓 |
| `maintenance/migrate_scs_doa_keys.py` | MongoDB 历史数据 | `scs_doa_results` | 一次性维护，不加入定时任务 |

下面两个文件是公共模块，不应作为定时任务直接执行：

- `scs_sync_lib.py`：SCS 登录、日期查询、水位线、稳定键和幂等写入。
- `spider_scs.py`、`enrich_scs_doa_sales_orders.py`：旧入口兼容代码和详情解析函数，仍被增量脚本导入。

## RTY 销售订单与维修补全

统一入口只处理 RTY 所需的 SAP 销售订单和已写入 MongoDB 的维修记录，不改变
SCS 同步链路。首次运行必须显式指定历史起点：

```bash
uv run --project backend python scripts/sync_rty_incremental.py \
  bootstrap --start-date 2026-01-01
```

首次任务仅在 SG、KK 请求成功后为两来源建立水位线。后续 cron 只调用：

```bash
uv run --project backend python scripts/sync_rty_incremental.py run
```

每个来源按自己的 `CHDAT` 水位线查询，默认从水位线前 7 天回看至任务当天，按
`AUFNR` 幂等更新。单来源失败不会推进该来源水位线，成功来源仍会推进；两来源
失败时任务返回非零退出码。产品层次由 `RTY_SYNC_PRODH_LIST` 配置（逗号分隔，默认
`00100`）。支持 `--only sales|repair`、`--dry-run`、`--lookback-days N`。

维修阶段只扫描 `repair_records_sap` 中 `AUFNR`、`VBELN` 或 `customer` 为空的文档，
按维修/过站/序列绑定/故障/销售订单/BOM 的本地关联补全，仍缺订单的唯一 SN 按批调用
`ZSIMS_CL_INBOUND_SN_INFO`，最后用 `sales_orders_sap.data.NAME1_ZU` 补客户。已有值不覆盖；
候选冲突写入 `rty_backfill` 审计字段。任务运行摘要写入 `rty_sync_runs`，来源水位线写入
`rty_sync_checkpoints`。

建议 cron（每日 02:10）：

```cron
10 2 * * * cd /Users/libiao/Desktop/github/QualityMonitoringSystem && /usr/local/bin/uv run --project backend python scripts/sync_rty_incremental.py run >> /var/log/quality-monitoring-rty.log 2>&1
```

锁文件默认 `/tmp/quality-monitoring-rty-sync.lock`，可通过 `RTY_SYNC_LOCK_PATH` 覆盖。

审计查询示例：

```javascript
use quality_monitoring
db.rty_sync_checkpoints.find({ _id: /^sales_orders:/ })
db.rty_sync_runs.find().sort({ started_at: -1 }).limit(20)
```

## 2. 运行前准备

### 2.1 安装依赖

在仓库根目录执行：

```bash
cd /Users/libiao/Desktop/github/QualityMonitoringSystem
uv sync --project backend
```

脚本需要 `requests`、`lxml` 和 `pymongo`。其中 `requests`、`pymongo` 随后端环境安装；
请先运行下面的导入检查：

```bash
uv run --project backend python -c \
  'import requests, pymongo, lxml; print("runtime dependencies ok")'
```

如果检查提示缺少 `lxml`，在当前后端虚拟环境中安装：

```bash
uv pip install --project backend lxml
```

### 2.2 配置环境变量

至少需要配置 SCS 账号密码：

```bash
export SCS_USERNAME='你的 SCS 账号'
export SCS_PASSWORD='你的 SCS 密码'
```

MongoDB 默认连接地址为 `mongodb://10.17.154.252:27019`，数据库为 `quality_monitoring`。
如部署环境不同，可以覆盖：

```bash
export MONGODB_URL='mongodb://主机:端口'
export MONGODB_DB_NAME='quality_monitoring'
```

不要把账号密码直接写入 Git、脚本文件或公开的 crontab。生产环境建议使用权限为 `600` 的环境文件。

## 3. SCS DOA 同步

### 3.1 首次同步历史数据

历史集合为空时，必须提供起始日期。脚本会从该日期同步到当天，按日期分页，并补采 DOA 产品实体详情：

```bash
uv run --project backend python scripts/sync_scs_incremental.py \
  --start-date 2026-01-01
```

常用参数：

```text
--start-date YYYY-MM-DD   历史集合为空时的起始日期
--page-size 500           每页记录数，默认 500
--max-pages 1000          最大页数，默认 1000
--timeout 120             单次请求读取超时时间（秒）
--dry-run                 请求并统计，但不写 MongoDB
```

如果库中已有旧版 DOA 数据，但还没有 `scs_key`，首次运行需要执行稳定键迁移：

```bash
uv run --project backend python scripts/sync_scs_incremental.py \
  --start-date 2026-01-01 \
  --migrate-keys
```

`--migrate-keys` 会按服务单号合并旧重复记录并建立唯一索引，执行前应完成数据库备份。

### 3.2 后续增量同步

首次同步成功后，使用同一个命令但不再传 `--start-date`：

```bash
uv run --project backend python scripts/sync_scs_incremental.py \
  --lookback-days 1 \
  --retry-failed
```

脚本行为如下：

1. 从 `scs_doa_incremental_progress` 读取 `watermark_date`。
2. 查询范围为 `watermark_date - lookback_days` 到当天。
3. 按 `scs_key` 幂等更新 `scs_doa_results`，不会因重复运行产生重复记录。
4. 只有列表同步和所有详情补采都成功时，才推进水位线。
5. 使用文件锁防止多个增量实例同时运行。

`--lookback-days 1` 用于覆盖边界日期内迟到或被修改的记录。若 SCS 数据延迟明显，可改为 2 或 3。

### 3.3 失败详情重试

增量任务遇到详情请求失败时，会写入：

```text
scs_enrichment.status = "failed"
scs_enrichment.last_error
scs_enrichment.attempts
```

使用以下命令重试：

```bash
uv run --project backend python scripts/sync_scs_incremental.py \
  --retry-failed
```

如果失败记录很多，不要直接用很小的 `--limit` 期待脚本只处理前几条。当前实现会在候选记录数量超过 `--limit` 时直接终止，以避免水位线跳过未处理记录。建议先查看失败数量，再设置足够大的 `--limit`，或先修复外部原因后整体重试。

### 3.4 查看水位线和失败记录

```javascript
use quality_monitoring

db.scs_doa_incremental_progress.findOne({
  _id: "scs_doa_incremental"
})

db.scs_doa_results.find(
  { "scs_enrichment.status": "failed" },
  {
    "data.服务单号": 1,
    "data.服务单号_id": 1,
    "scs_enrichment.last_error": 1,
    "scs_enrichment.attempts": 1
  }
)
```

## 4. SAP 销售订单同步

`maintenance/sync_sales_orders_range.py` 按指定日期范围从 SAP SG/KK 拉取订单并写入 `sales_orders_sap`。它是范围同步，不使用 SCS DOA 水位线；定时任务应显式计算日期范围。

从仓库根目录执行：

```bash
uv run --project backend python scripts/maintenance/sync_sales_orders_range.py \
  --start 2026-08-20 \
  --end 2026-08-21
```

按产品层次过滤：

```bash
uv run --project backend python scripts/maintenance/sync_sales_orders_range.py \
  --start 2026-08-20 \
  --end 2026-08-21 \
  --prodh-list 00100 00200
```

不传 `--prodh-list` 参数值表示不限制产品层次。每次执行会对 `aufnr` 做幂等更新，输出 `inserted` 和 `updated` 数量。

## 5. SCS 换件登记同步

`spider_change_result.py` 使用页码断点，写入 `scs_change_results`，以 `record_key` 唯一索引避免重复。

首次或完整同步：

```bash
uv run --project backend python scripts/spider_change_result.py \
  --start-page 1 \
  --page-count 686 \
  --page-size 500
```

补采指定页，例如第 21 至 30 页：

```bash
uv run --project backend python scripts/spider_change_result.py \
  --start-page 21 \
  --page-count 10
```

已完成页会记录在 `<collection>_progress.completed_pages` 中并跳过。若要重新抓取已完成页，先在 MongoDB 中删除对应进度文档（或移除对应页号），再重新执行命令：

```javascript
use quality_monitoring
db.scs_change_results_progress.deleteOne({
  _id: "PM_sp_change_Result_01"
})
```

删除进度前应确认目标集合已有备份；重新抓取不会重复插入相同 `record_key`。

## 6. MFR 看板数据要求

MFR 页面路径为 `/mfr`，接口为 `GET /api/mfr/dashboard`。它不修改
`scs_change_results`，而是在查询时通过以下关系关联 5000 销售订单：

```text
scs_change_results.data.服务单号
  -> scs_doa_results.data.服务单号
  -> scs_doa_results.scs_enrichment.sales_order
  -> sales_orders_sap.data.VBELN
```

分子只统计未撤销的 `操作类型=换上` / `换上-up` 记录，并按统计月份和报修设备去重；
分母按销售订单数量汇总，要求同时具备出厂日期和过保日期，且满足：

```text
出厂日期 <= 统计时间点 <= 过保日期
```

销售订单生命周期字段可使用以下规范字段之一：

- 出厂日期：`factory_date`、`data.出厂日期`、`data.生产日期`、`data.FACTORY_DATE`
- 过保日期：`warranty_end_date`、`data.保修结束日期`、`data.质保到期日`、`data.WARRANTY_END_DATE`

没有日期的订单会在页面顶部显示覆盖率告警，并从分母排除。上线前必须确认
`warrantyDateCoverage` 达到预期，不能把日期缺失当成在保。

## 7. 定时任务示例

创建 `/etc/quality-monitoring/scs.env`：

```bash
SCS_USERNAME=your_username
SCS_PASSWORD=your_password
MONGODB_URL=mongodb://10.17.154.252:27019
MONGODB_DB_NAME=quality_monitoring
```

设置文件权限：

```bash
sudo chmod 600 /etc/quality-monitoring/scs.env
```

使用 cron 每小时执行一次 SCS DOA 增量：

```cron
0 * * * * . /etc/quality-monitoring/scs.env; cd /Users/libiao/Desktop/github/QualityMonitoringSystem && /usr/local/bin/uv run --project backend python scripts/sync_scs_incremental.py --lookback-days 1 --retry-failed >> /var/log/quality-monitoring-scs.log 2>&1
```

同一时间只允许一个实例运行。脚本遇到运行中的实例会直接退出，不会并发写库。

## 8. 常见问题

### `历史集合为空，请首次运行时提供 --start-date`

首次运行增加 `--start-date YYYY-MM-DD`。

### `达到 --max-pages 仍未遇到短页/空页`

查询范围超过默认页数，增加 `--max-pages` 后重试。不要直接推进水位线，先确认数据是否完整。

### `scs_key 存在重复记录`

先备份数据库，再执行：

```bash
uv run --project backend python scripts/maintenance/migrate_scs_doa_keys.py
```

或在增量脚本中增加 `--migrate-keys`。迁移完成后重新运行增量任务。

### 登录成功但业务请求失败

确认 SCS 账号权限、服务器网络和 `MONGODB_URL`。增加 `--timeout` 只能缓解慢响应，不能解决账号无权限或网络不可达。

### 任务重复运行

SCS DOA 增量脚本使用单实例锁；检查是否有旧进程未退出，以及 `SCS_INCREMENTAL_LOCK_PATH` 指向的锁文件是否可写。

## 9. 上线前检查清单

- [ ] 已完成 MongoDB 备份。
- [ ] 首次同步已确认起始日期和 SCS 查询范围。
- [ ] 首次同步完成后已确认水位线存在且状态为 `success`。
- [ ] 已检查 `scs_enrichment.status = "failed"` 的记录数量。
- [ ] 定时任务只调用 `sync_scs_incremental.py`，没有同时调用旧的全量入口。
- [ ] 环境文件权限为 `600`，日志中未输出密码。
- [ ] 已验证单实例锁和失败退出码能被调度器识别。
