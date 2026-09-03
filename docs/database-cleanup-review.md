# MongoDB 集合清理评审

本文按当前 FastAPI 运行时代码评估，不把 `scripts/archive/data_sync/` 中的历史同步、
抓取和回填脚本视为运行时依赖。五个 SAP/HANA 本地副本和 `_hana_sync_runs` 已在迁移
验证后删除；后续清理脚本仍采用白名单和 dry-run 保护。

## 可立即下线

### `assembly_records`

当前没有 API、服务或后台任务读取该集合，仅剩旧的模型常量、启动索引和 README 描述。
本次已移除模型常量和启动时索引创建。确认不需要历史装配数据后，可以删除 MongoDB 集合。

## 仅由已归档脚本使用的集合

下列集合在当前 `backend/app` 运行时代码中没有读取方，若数据库中存在，可在备份后删除：

- `repair_order_backfill_runs`
- `repair_sn_api_backfill_runs`
- `repair_customer_backfill_runs`
- `order_bom_gstrs_backfill_runs`
- `order_bom_sales_order_cleanup_runs`
- `station_pass_field_backfill_checkpoints`
- `station_pass_field_backfill_runs`
- `scs_doa_progress`
- `scs_doa_sales_order_progress`
- `rty_sync_runs`
- `_hana_sync_runs`
- `_sync_runs`
- `_sync_checkpoints`
- `scs_doa_results_progress`
- `scs_change_results_progress`
- `rty_data`
- `sales_orders`
- `sales_order_bom`
- `no_data_orders`

这些集合只保存历史回填或同步审计。删除后，归档脚本的历史审计查询将不可用。

执行方式：

```bash
cd /Users/libiao/Desktop/github/QualityMonitoringSystem/backend
uv run python scripts/cleanup_obsolete_collections.py       # 仅盘点
uv run python scripts/cleanup_obsolete_collections.py --apply # 执行删除
```

脚本采用固定白名单，并且不会删除 `assembly_records_bak` 备份集合。

## 当前不能删除

- `configs`：系统设置、机型目标、邮件预警和工位影像凭据。
- `users`、`sessions`：登录和会话。
- `usage_events`：运营监控统计。
- `machine_info`、`fault_info`：周预警和预警报告。
- `scs_doa_results`：DOA 和 MFR。
- `scs_change_results`：MFR 换件故障统计。
- `sales_orders_sap`、`order_bom_postings_sap`、`repair_records_sap`、
  `station_records_sap`、`serial_bindings_sap`：已删除，运行时由网关提供数据。

## 运营监控水位线

`rty_sync_checkpoints`、`_hana_sync_checkpoints` 和 `scs_doa_incremental_progress` 虽然
不再由当前调度脚本维护，但 `operations_service` 仍读取它们展示数据源状态，暂不能删除。
应先将运营监控改为读取网关的同步状态接口（例如 `/api/sync/status`），再清理这些集合和
对应索引。

## 删除后的运行约束

网关故障不会回退到已删除的本地 SAP/HANA 副本；部署必须配置
`DATA_GATEWAY_URL`。元数据页面保留表定义，但通过网关的分页接口展示。SCS 和 MES
本地集合不属于本次迁移范围。
