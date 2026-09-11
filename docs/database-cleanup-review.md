# MongoDB 集合清理评审

本文按当前 FastAPI 运行时代码评估。SAP/HANA 同步、抓取、回填和集合清理脚本均已从本仓库移除。
已确认本地 SCS 历史集合不再被运行时代码读取，本次由本项目执行物理删除。

## 可立即下线

### `assembly_records`

当前没有 API、服务或后台任务读取该集合，仅剩旧的模型常量、启动索引和 README 描述。
本次已移除模型常量和启动时索引创建。确认不需要历史装配数据后，可以删除 MongoDB 集合。

## 历史运行集合

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
- `scs_doa_incremental_progress`
- `scs_doa_results`
- `scs_change_results`
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

这些集合只保存历史回填或同步审计。

## 当前不能删除

- `configs`：系统设置、机型目标、邮件预警和工位影像凭据。
- `users`、`sessions`：登录和会话。
- `usage_events`：运营监控统计。
- `machine_info`、`fault_info`：周预警和预警报告。
- `sales_orders_sap`、`order_bom_postings_sap`、`repair_records_sap`、
  `station_records_sap`、`serial_bindings_sap`：运行时由网关提供数据；其本地副本的
  物理删除由数据源运维方处理。

## 运营监控水位线

`operations_service` 已从网关 `/api/data-status` 读取 SAP/HANA/SCS 同步状态，
不再读取 `rty_sync_checkpoints`、`_hana_sync_checkpoints` 或任何 SCS 进度集合。
这些集合仅在完成备份核验后保留或删除，不影响运行时。

## 删除后的运行约束

网关故障不会回退到已删除的本地 SAP/HANA/SCS 副本；部署必须配置
`DATA_GATEWAY_URL`。元数据页面保留逻辑表定义，但通过网关的分页接口展示。SCS
本地集合属于本次清理范围，后续出厂日期和质保日期只能由网关补充。
