# 历史数据同步脚本归档

本项目已改由数据网关提供 SAP、HANA 和 SCS 原始数据。原先将这些数据直接同步到本项目
MongoDB 的脚本，已归档至 [`scripts/archive/data_sync/`](../scripts/archive/data_sync/)，不再是
系统运行时能力。

## 禁止自动运行

不得为归档脚本配置 cron、systemd timer、CI 定时任务或其他自动调度。历史脚本会直接写入
本项目 MongoDB，误运行可能覆盖、重复或污染已不再使用的本地业务数据。

## 归档范围

| 类型 | 归档文件 | 历史写入集合 |
|---|---|---|
| RTY 销售订单和维修补全 | `sync_rty_incremental.py`、`maintenance/sync_sales_orders_range.py` | 已迁移至数据网关；历史集合：`sales_orders_sap`、`repair_records_sap`、`rty_sync_checkpoints` |
| HANA 质量视图 | `sync_views.py` | 已迁移至数据网关；历史集合：`order_bom_postings_sap`、`serial_bindings_sap`、`repair_records_sap`、`station_records_sap`、`_hana_sync_checkpoints`、`_hana_sync_runs` |
| SCS DOA 和换件记录 | `sync_scs_incremental.py`、`spider_change_result.py` | `scs_doa_results`、`scs_change_results`、`scs_doa_incremental_progress` |
| 历史回填和清理 | `maintenance/*` | 上述业务集合及历史运行审计集合 |

公共模块 `scs_sync_lib.py`、`spider_scs.py` 和 `enrich_scs_doa_sales_orders.py` 也一并归档，
仅供归档脚本内部使用。

## 必要时的人工恢复

仅在数据网关无法恢复指定历史数据，并取得数据负责人审批后，才可执行归档脚本。执行前应：

1. 备份将被写入的 MongoDB 集合。
2. 先在隔离环境或使用脚本提供的只读/预览参数验证范围。
3. 记录执行人、命令、时间窗口、写入数量和回滚位置。
4. 执行后与数据网关进行抽样对账。

当前保留的只读导出与诊断脚本见 [`scripts/README.md`](../scripts/README.md)。
